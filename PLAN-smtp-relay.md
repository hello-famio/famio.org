# Plan: SMTP relay for outbound family email with footer injection

Family members configure Gmail/Outlook to send email from `smiths@famio.org`. All
outbound mail passes through a thin SMTP proxy on GCP, which forwards to the Famio
Worker. The Worker injects a signup footer and delivers via Resend.

---

## Architecture

```
Gmail/Outlook
  │  "Send mail as" smiths@famio.org
  │  smtp.famio.org:587
  ▼
┌─────────────────────────────┐
│  SMTP Proxy (GCP e2-micro)  │  TCP → HTTP bridge only
│  smtp/                      │  Accepts SMTP auth + DATA
│                             │  POSTs raw message to Worker
└─────────────┬───────────────┘
              │ POST /internal/smtp-send
              │ { username, password, raw_message_b64 }
              ▼
┌─────────────────────────────┐
│  Cloudflare Worker          │  All business logic lives here
│  src/                       │  • Validates credentials vs D1
│                             │  • Injects footer (text + HTML)
│                             │  • Sends via Resend API
└─────────────────────────────┘
```

The proxy is a pure TCP→HTTP bridge (~150 lines). No Resend key, no D1 access,
no business logic. If it goes down, families can't send — but no data is at risk.

---

## Repo structure changes

```
famio.org/
├── infra/                     ← NEW: Terraform for GCP e2-micro
│   ├── main.tf
│   ├── vm.tf
│   ├── firewall.tf
│   └── variables.tf
├── smtp/                      ← NEW: SMTP proxy service
│   ├── src/
│   │   └── index.ts
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile
│   └── .env.example
├── src/
│   ├── index.ts               ← add /internal/smtp-send route
│   ├── templates.ts           ← add SMTP credentials section to manage page
│   ├── services/
│   │   └── email.ts           ← add sendOutboundWithFooter()
│   └── db/
│       └── schema.sql         ← add smtp_password_hash column
└── PLAN-smtp-relay.md         ← this file
```

---

## 1. GCP infrastructure (`infra/`)

Terraform provisions a single free-tier e2-micro VM in `us-central1`. The VM runs
the SMTP proxy as a systemd service via a Docker container.

### `infra/variables.tf`

```hcl
variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region (must be us-central1, us-east1, or us-west1 for free tier)"
  type        = string
  default     = "us-central1"
}

variable "zone" {
  type    = string
  default = "us-central1-a"
}

variable "smtp_relay_secret" {
  description = "Shared secret between SMTP proxy and Worker"
  type        = string
  sensitive   = true
}

variable "worker_internal_url" {
  description = "https://famio.org/internal/smtp-send"
  type        = string
  default     = "https://famio.org/internal/smtp-send"
}
```

### `infra/main.tf`

```hcl
terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
```

### `infra/vm.tf`

```hcl
# Static external IP — free while attached to a running instance in free-tier regions.
resource "google_compute_address" "smtp_proxy" {
  name   = "famio-smtp-proxy-ip"
  region = var.region
}

resource "google_compute_instance" "smtp_proxy" {
  name         = "famio-smtp-proxy"
  machine_type = "e2-micro"   # always-free tier
  zone         = var.zone

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 10  # GB — well within free 30GB allowance
    }
  }

  network_interface {
    network = "default"
    access_config {
      nat_ip = google_compute_address.smtp_proxy.address
    }
  }

  # Cloud-init: install Docker, pull image, configure systemd service.
  metadata = {
    user-data = templatefile("${path.module}/cloud-init.yaml", {
      smtp_relay_secret   = var.smtp_relay_secret
      worker_internal_url = var.worker_internal_url
    })
  }

  tags = ["famio-smtp-proxy"]

  # Allow Terraform to replace the instance if the startup script changes.
  lifecycle {
    create_before_destroy = true
  }
}

output "smtp_proxy_ip" {
  value       = google_compute_address.smtp_proxy.address
  description = "Set smtp.famio.org A record to this IP"
}
```

### `infra/firewall.tf`

```hcl
resource "google_compute_firewall" "smtp_submission" {
  name    = "famio-smtp-submission"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["587"]
  }

  # Restrict to Gmail and Outlook SMTP client IP ranges in production.
  # For now allow all — tighten after confirming Gmail/Outlook source ranges.
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["famio-smtp-proxy"]
}

resource "google_compute_firewall" "ssh" {
  name    = "famio-smtp-proxy-ssh"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  # Restrict to your IP in production.
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["famio-smtp-proxy"]
}
```

### `infra/cloud-init.yaml`

```yaml
#cloud-config
package_update: true
packages:
  - docker.io

write_files:
  - path: /etc/famio-smtp/.env
    permissions: "0600"
    content: |
      SMTP_RELAY_SECRET=${smtp_relay_secret}
      WORKER_INTERNAL_URL=${worker_internal_url}
      PORT=587

  - path: /etc/systemd/system/famio-smtp.service
    content: |
      [Unit]
      Description=Famio SMTP proxy
      After=docker.service
      Requires=docker.service

      [Service]
      Restart=always
      ExecStartPre=-/usr/bin/docker pull ghcr.io/YOUR_GITHUB_ORG/famio-smtp:latest
      ExecStart=/usr/bin/docker run --rm \
        --name famio-smtp \
        -p 587:587 \
        --env-file /etc/famio-smtp/.env \
        ghcr.io/YOUR_GITHUB_ORG/famio-smtp:latest
      ExecStop=/usr/bin/docker stop famio-smtp

      [Install]
      WantedBy=multi-user.target

runcmd:
  - systemctl daemon-reload
  - systemctl enable famio-smtp
  - systemctl start famio-smtp
```

---

## 2. SMTP proxy (`smtp/`)

Pure TCP→HTTP bridge. Accepts SMTP auth + message, POSTs raw bytes to the Worker,
returns SMTP status code based on the Worker's response.

### `smtp/package.json`

```json
{
  "name": "famio-smtp-proxy",
  "version": "1.0.0",
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "smtp-server": "^3.13.0"
  },
  "devDependencies": {
    "@types/smtp-server": "^3.5.10",
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

### `smtp/src/index.ts`

```typescript
import { SMTPServer } from "smtp-server";

const PORT = parseInt(process.env.PORT ?? "587");
const SMTP_RELAY_SECRET = process.env.SMTP_RELAY_SECRET ?? "";
const WORKER_URL = process.env.WORKER_INTERNAL_URL ?? "https://famio.org/internal/smtp-send";

if (!SMTP_RELAY_SECRET) throw new Error("SMTP_RELAY_SECRET is required");

const server = new SMTPServer({
  // STARTTLS — required by Gmail/Outlook for port 587.
  // In production, provide a real TLS cert (e.g. via certbot on the VM).
  secure: false,
  starttls: true,
  // Self-signed cert for local dev; replace with Let's Encrypt cert on GCP.
  key: process.env.TLS_KEY,
  cert: process.env.TLS_CERT,

  // Require auth before accepting mail.
  authRequired: true,
  authMethods: ["PLAIN", "LOGIN"],

  // Delegate auth + delivery to the Worker in one call.
  // smtp-server calls onAuth before onData, so we store credentials on the session.
  onAuth(auth, session, callback) {
    // Store credentials on session object for use in onData.
    (session as any).smtpUsername = auth.username;
    (session as any).smtpPassword = auth.credentials?.password ?? "";
    // Accept auth here — the Worker validates the actual credentials on send.
    // This avoids a round-trip per connection just for auth.
    callback(null, { user: auth.username });
  },

  async onData(stream, session, callback) {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", async () => {
      const rawMessage = Buffer.concat(chunks).toString("base64");
      const username = (session as any).smtpUsername ?? "";
      const password = (session as any).smtpPassword ?? "";

      try {
        const res = await fetch(WORKER_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Relay-Secret": SMTP_RELAY_SECRET,
          },
          body: JSON.stringify({ username, password, raw_message_b64: rawMessage }),
        });

        if (res.ok) {
          callback();
        } else {
          const body = await res.json<{ error?: string }>();
          const msg = body.error ?? "Delivery failed";
          callback(new Error(msg));
        }
      } catch (err) {
        console.error("Worker call failed:", err);
        callback(new Error("Internal relay error"));
      }
    });
  },
});

server.listen(PORT, () => {
  console.log(`Famio SMTP proxy listening on port ${PORT}`);
});
```

### `smtp/Dockerfile`

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 587
CMD ["node", "dist/index.js"]
```

### `smtp/.env.example`

```
SMTP_RELAY_SECRET=change-me
WORKER_INTERNAL_URL=https://famio.org/internal/smtp-send
PORT=587
TLS_KEY=/etc/letsencrypt/live/smtp.famio.org/privkey.pem
TLS_CERT=/etc/letsencrypt/live/smtp.famio.org/fullchain.pem
```

---

## 3. Schema migration (`src/db/schema.sql`)

Add one column to `addresses`:

```sql
ALTER TABLE addresses ADD COLUMN smtp_password_hash TEXT;
```

Apply to production:
```bash
wrangler d1 execute famio --remote --command \
  "ALTER TABLE addresses ADD COLUMN smtp_password_hash TEXT"
```

---

## 4. Worker changes (`src/`)

### New route: `POST /internal/smtp-send`

Add to the main router in `src/index.ts`:

```typescript
if (
  request.method === "POST" &&
  url.pathname === "/internal/smtp-send"
)
  return handleSmtpSend(request, ctx);
```

Handler:

```typescript
async function handleSmtpSend(request: Request, ctx: AppContext): Promise<Response> {
  // Verify shared secret — reject anything not from our proxy.
  const secret = request.headers.get("X-Relay-Secret");
  if (!secret || secret !== ctx.env.SMTP_RELAY_SECRET) {
    return json({ error: "Forbidden" }, 403);
  }

  let body: { username?: string; password?: string; raw_message_b64?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const { username, password, raw_message_b64 } = body;
  if (!username || !password || !raw_message_b64) {
    return json({ error: "Missing required fields" }, 400);
  }

  // username is the full address e.g. "smiths@famio.org"
  const name = username.split("@")[0].toLowerCase();

  const address = await ctx.env.DB.prepare(
    "SELECT * FROM addresses WHERE name = ? AND active = 1"
  ).bind(name).first<AddressRow & { smtp_password_hash: string | null }>();

  if (!address?.smtp_password_hash) {
    return json({ error: "Invalid credentials" }, 401);
  }

  const validPassword = await verifyPassword(password, address.smtp_password_hash);
  if (!validPassword) {
    return json({ error: "Invalid credentials" }, 401);
  }

  // Decode raw message, inject footer, send via Resend.
  const rawMessage = atob(raw_message_b64);
  await ctx.email.sendOutboundWithFooter({
    rawMessage,
    addressName: address.name,
    domain: ctx.domain,
    tier: address.tier,
  });

  return json({ ok: true });
}

// bcrypt-lite or Web Crypto PBKDF2 for password verification.
// Workers support SubtleCrypto natively — use PBKDF2 to avoid a bcrypt dep.
async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // hash format: "pbkdf2:sha256:<iterations>:<salt_b64>:<hash_b64>"
  const [, , iterStr, saltB64, hashB64] = hash.split(":");
  const iterations = parseInt(iterStr);
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const expected = Uint8Array.from(atob(hashB64), (c) => c.charCodeAt(0));

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    keyMaterial,
    256
  );

  const derived8 = new Uint8Array(derived);
  if (derived8.length !== expected.length) return false;
  // Constant-time comparison.
  let diff = 0;
  for (let i = 0; i < derived8.length; i++) diff |= derived8[i] ^ expected[i];
  return diff === 0;
}
```

### SMTP credential generation at signup

In `handleSignup`, after creating the address:

```typescript
// Generate SMTP credentials
const smtpPassword = newToken().slice(0, 32); // 32-char random hex
const smtpHash = await hashPassword(smtpPassword);
await ctx.env.DB.prepare(
  "UPDATE addresses SET smtp_password_hash = ? WHERE id = ?"
).bind(smtpHash, addressId).run();

// Include in magic link email so owner has it on first login
await ctx.email.sendMagicLink({
  to: ownerEmail,
  addressName: name,
  domain: ctx.domain,
  token: magicToken,
  baseUrl: ctx.baseUrl,
  smtpPassword, // add to SendMagicLinkOpts
});
```

`hashPassword` mirrors `verifyPassword` using SubtleCrypto PBKDF2.

### New email method: `sendOutboundWithFooter`

Add to `EmailService` interface and `resendEmailService` in `src/services/email.ts`:

```typescript
export interface SendOutboundOpts {
  rawMessage: string;    // raw MIME message from SMTP client
  addressName: string;
  domain: string;
  tier: string;          // "no_footer" skips injection
}

// In the service implementation:
async sendOutboundWithFooter({ rawMessage, addressName, domain, tier }) {
  // 1. Parse the raw MIME message to extract headers, text, html parts.
  //    Use the `postal-mime` package (already a dependency for V1.5 work).
  // 2. If tier !== "no_footer", inject text and HTML footer.
  // 3. POST to Resend /emails with from: `${addressName}@${domain}`.
},
```

Footer copy:

```
-- (text/plain)
Sent via smiths@famio.org · famio.org — family email, simplified

<!-- HTML -->
<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;
            font-size:0.8rem;color:#a0aec0;font-family:sans-serif;">
  Sent via <strong>smiths@famio.org</strong> ·
  <a href="https://famio.org" style="color:#4ecdc4;text-decoration:none;">
    Get your own family address
  </a>
</div>
```

### New `Env` field

```typescript
export interface Env {
  // ... existing fields
  SMTP_RELAY_SECRET?: string;
}
```

Add secret to production:
```bash
wrangler secret put SMTP_RELAY_SECRET
```

---

## 5. Manage page (`src/templates.ts`)

Add an SMTP credentials card to `managePage`. Show after the members list:

```
Send from your family address
─────────────────────────────────────────────────────
Configure Gmail or Outlook to send as smiths@famio.org:

  SMTP host   smtp.famio.org
  Port        587
  Username    smiths@famio.org
  Password    ••••••••  [Reveal]  [Regenerate]

Instructions: gmail-setup-link  outlook-setup-link
```

Regenerate hits a new endpoint `POST /manage/smtp-password` (authenticated by magic
link token), generates a new password, hashes and stores it, returns the plaintext
once. Owner must reconfigure their email client after regenerating.

---

## 6. DNS

After `terraform apply` outputs the GCP IP:

```
smtp.famio.org   A   <GCP_IP>
```

Update SPF if not already covering Resend's sending IPs:
```
famio.org   TXT   "v=spf1 include:_spf.resend.com ~all"
```

No MX change needed — inbound routing stays on PurelyMail.

---

## 7. TLS certificate on the VM

Gmail and Outlook require STARTTLS with a valid certificate on port 587. After the VM
is provisioned:

```bash
# SSH into the VM
gcloud compute ssh famio-smtp-proxy --zone=us-central1-a

# Install certbot and get a cert for smtp.famio.org
sudo apt install certbot
sudo certbot certonly --standalone -d smtp.famio.org \
  --pre-hook "systemctl stop famio-smtp" \
  --post-hook "systemctl start famio-smtp"

# Auto-renew is configured by certbot systemd timer automatically
```

Set `TLS_KEY` and `TLS_CERT` env vars in `/etc/famio-smtp/.env` to the Let's Encrypt
paths and restart the service.

---

## 8. New secrets

| Secret | Where | How |
|--------|-------|-----|
| `SMTP_RELAY_SECRET` | Worker + GCP VM | `wrangler secret put` + `/etc/famio-smtp/.env` |
| `TLS_KEY` / `TLS_CERT` | GCP VM only | Let's Encrypt via certbot |

No new secrets are needed in Resend — the existing `RESEND_API_KEY` handles sending.

---

## 9. Deploy sequence (first time)

```bash
# 1. Provision GCP infra
cd infra
terraform init
terraform apply -var="project_id=YOUR_PROJECT" -var="smtp_relay_secret=RANDOM_SECRET"
# Note the output IP → set smtp.famio.org DNS A record

# 2. SSH in and get TLS cert
gcloud compute ssh famio-smtp-proxy --zone=us-central1-a
sudo certbot certonly --standalone -d smtp.famio.org ...
# Update /etc/famio-smtp/.env with cert paths, restart service

# 3. Apply D1 schema migration
wrangler d1 execute famio --remote --command \
  "ALTER TABLE addresses ADD COLUMN smtp_password_hash TEXT"

# 4. Add Worker secret
wrangler secret put SMTP_RELAY_SECRET   # same value as Terraform var

# 5. Build and push proxy Docker image
cd smtp
docker build -t ghcr.io/YOUR_ORG/famio-smtp:latest .
docker push ghcr.io/YOUR_ORG/famio-smtp:latest

# 6. Deploy Worker
bun run deploy
```

---

## 10. Open questions / follow-up

- **MIME builder**: Resolved — see section 11.
- **Rate limiting**: The `/internal/smtp-send` endpoint should rate-limit per family
  (e.g. 50 sends/day on free tier) to prevent abuse if SMTP credentials leak.
- **Firewall tightening**: Lock down port 587 to Gmail and Outlook SMTP client IP
  ranges once confirmed working, to reduce attack surface.
- **`POST /manage/smtp-password`**: Regenerate endpoint not detailed above — small
  addition following the same pattern as other manage endpoints.

---

## 11. Resolving the MIME builder issue (TODO 1)

**The problem stated in TODOS.md:** `postal-mime` parses MIME into structured parts
but can't reassemble them. Footer injection on multipart emails seemed to require a
MIME builder.

**Resolution:** No MIME builder is needed. Resend's HTTP API accepts `text`, `html`,
and `attachments` as separate fields — not a raw MIME message. So the flow is:

```
raw MIME (from SMTP client)
  │
  ▼ postal-mime.parse()
  │
  ├── subject, from, to, replyTo, headers
  ├── text    ← append text footer here
  ├── html    ← append HTML footer here
  └── attachments[]  ← pass through as-is
  │
  ▼ POST /emails (Resend API)
  { from, to, subject, text, html, attachments }
```

`postal-mime` returns `attachments` with `content` as `Uint8Array`. Resend expects
`content` as base64 — one `btoa(String.fromCharCode(...attachment.content))` call
per attachment. No reconstruction of the MIME envelope needed.

This also means TODO 1 in `TODOS.md` can be **closed** once `postal-mime` is added
as a dependency and `sendOutboundWithFooter` is implemented.

### Install

```bash
bun add postal-mime
bun add -d @types/postal-mime   # if types aren't bundled
```

### Implementation of `sendOutboundWithFooter`

```typescript
import PostalMime from "postal-mime";

export interface SendOutboundOpts {
  rawMessage: string;      // raw MIME bytes as string (decoded from base64 by Worker)
  envelopeFrom: string;    // SMTP MAIL FROM (from proxy session)
  envelopeTo: string[];    // SMTP RCPT TO (from proxy session)
  addressName: string;     // e.g. "smiths"
  domain: string;          // e.g. "famio.org"
  tier: string;
}

// In resendEmailService:
async sendOutboundWithFooter({
  rawMessage, envelopeFrom, envelopeTo, addressName, domain, tier
}) {
  const parsed = await new PostalMime().parse(rawMessage);

  const injectFooter = tier !== "no_footer";

  const textFooter = `\n\n--\nSent via ${addressName}@${domain} · famio.org`;
  const htmlFooter = `
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;
                font-size:0.8rem;color:#a0aec0;font-family:sans-serif;">
      Sent via <strong>${addressName}@${domain}</strong> ·
      <a href="https://famio.org" style="color:#4ecdc4;text-decoration:none;">
        Get your own family address
      </a>
    </div>`;

  const text = injectFooter && parsed.text
    ? parsed.text + textFooter
    : parsed.text;

  const html = injectFooter && parsed.html
    ? parsed.html.replace("</body>", `${htmlFooter}</body>`)
    : parsed.html;

  const attachments = (parsed.attachments ?? []).map((a) => ({
    filename: a.filename ?? "attachment",
    content: btoa(String.fromCharCode(...new Uint8Array(a.content as ArrayBuffer))),
  }));

  await resendSend(apiKey, {
    from: `${addressName}@${domain}`,
    to: envelopeTo,
    subject: parsed.subject ?? "(no subject)",
    text,
    html,
    attachments: attachments.length ? attachments : undefined,
    replyTo: parsed.replyTo?.[0]?.address,
  });
},
```

Update `resendSend` to accept the full object instead of individual args, since we're
now passing more fields.

### Proxy change: pass envelope in request body

The smtp-server `session` object exposes the envelope before the message body arrives.
Update `onData` in `smtp/src/index.ts` to include it:

```typescript
body: JSON.stringify({
  username,
  password,
  raw_message_b64: rawMessage,
  envelope_from: session.envelope.mailFrom.address,
  envelope_to: session.envelope.rcptTo.map((r) => r.address),
}),
```

Update `handleSmtpSend` in `src/index.ts` to read and pass these fields through to
`sendOutboundWithFooter`.

---

## 12. Testing

### Test structure

```
famio.org/
├── test/
│   ├── integration/
│   │   ├── signup.test.ts          (existing)
│   │   ├── manage.test.ts          (existing)
│   │   ├── confirm-unsubscribe.test.ts  (existing)
│   │   └── smtp-send.test.ts       ← NEW
│   ├── unit/
│   │   └── footer-injection.test.ts  ← NEW
│   └── fixtures/
│       └── emails/                 ← NEW: sample .eml files
│           ├── text-only.eml
│           ├── html-only.eml
│           ├── multipart.eml
│           └── with-attachment.eml
└── smtp/
    └── test/
        └── proxy.test.ts           ← NEW: proxy unit tests
```

### Email fixtures

Real `.eml` files captured from Gmail. Use `nodemailer` to generate them locally
during test setup, or commit a minimal set. Each fixture exercises a different MIME
structure that footer injection must handle correctly.

**Generate fixtures once:**
```bash
cd smtp && node scripts/generate-fixtures.js
# writes test/fixtures/emails/*.eml
```

### Worker: `/internal/smtp-send` tests (`test/integration/smtp-send.test.ts`)

Runs in `@cloudflare/vitest-pool-workers`. Tests the full endpoint path including
D1 credential lookup, footer injection, and Resend call (mocked).

```typescript
describe("POST /internal/smtp-send", () => {
  // Auth / secret checks
  it("returns 403 when X-Relay-Secret is missing")
  it("returns 403 when X-Relay-Secret is wrong")

  // Credential validation
  it("returns 401 when family address does not exist")
  it("returns 401 when password is wrong")
  it("returns 400 when required fields are missing")

  // Footer injection — one test per fixture
  it("injects text footer into text-only email")
  it("injects html footer into html-only email")
  it("injects both footers into multipart email")
  it("passes attachments through unchanged")
  it("skips footer injection on no_footer tier")

  // Happy path
  it("returns 200 and calls Resend with correct from address")
  it("preserves Reply-To header from original message")
  it("uses envelope To, not header To")
});
```

### Worker: footer injection unit tests (`test/unit/footer-injection.test.ts`)

Pure unit tests for the `postal-mime` parse + footer append logic, isolated from
the HTTP layer. Fast and easy to iterate on fixture edge cases.

```typescript
describe("footer injection", () => {
  it("appends text footer after double newline")
  it("inserts html footer before </body>")
  it("handles html with no </body> tag — appends at end")
  it("handles email with no text part — only injects into html")
  it("handles email with no html part — only injects into text")
  it("handles email with neither text nor html — sends as-is")
  it("correctly base64-encodes attachment content for Resend")
});
```

### SMTP proxy tests (`smtp/test/proxy.test.ts`)

Standard Node.js tests (Vitest). Spin up the proxy on a random port and a mock
HTTP server standing in for the Worker endpoint.

```typescript
describe("SMTP proxy", () => {
  // Spins up proxy + mock Worker on random ports before each test.

  it("rejects connection with no auth")
  it("accepts PLAIN auth and forwards credentials to Worker")
  it("forwards raw message body to Worker as base64")
  it("forwards envelope from/to from SMTP session")
  it("returns SMTP 250 when Worker responds 200")
  it("returns SMTP 550 when Worker responds 401")
  it("returns SMTP 451 when Worker call fails with network error")
  it("includes X-Relay-Secret header on every Worker call")
});
```

Use `nodemailer` as the SMTP client in tests — it's the standard way to drive
`smtp-server` in test environments:

```bash
cd smtp && bun add -d nodemailer @types/nodemailer
```

### Run commands

```bash
# Worker tests (existing + new)
bun test

# Proxy tests
cd smtp && bun test

# All tests
bun test && cd smtp && bun test
```

---

## 13. CI/CD (GitHub Actions)

### `.github/workflows/ci.yml` — runs on every PR

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  worker-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun test

  proxy-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - working-directory: smtp
        run: bun install
      - working-directory: smtp
        run: bun test

  terraform-plan:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - working-directory: infra
        run: terraform init
      - working-directory: infra
        env:
          GOOGLE_CREDENTIALS: ${{ secrets.GCP_SA_KEY }}
        run: terraform plan -var="project_id=${{ secrets.GCP_PROJECT_ID }}"
```

### `.github/workflows/deploy.yml` — runs on push to main

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy-worker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

  deploy-proxy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          context: smtp
          push: true
          tags: ghcr.io/${{ github.repository_owner }}/famio-smtp:latest
      # SSH into GCP VM and pull + restart the container
      - name: Redeploy on GCP
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.GCP_VM_IP }}
          username: famio
          key: ${{ secrets.GCP_SSH_KEY }}
          script: |
            docker pull ghcr.io/${{ github.repository_owner }}/famio-smtp:latest
            systemctl restart famio-smtp

  terraform-apply:
    runs-on: ubuntu-latest
    needs: [deploy-worker, deploy-proxy]
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - working-directory: infra
        run: terraform init
      - working-directory: infra
        env:
          GOOGLE_CREDENTIALS: ${{ secrets.GCP_SA_KEY }}
        run: |
          terraform apply -auto-approve \
            -var="project_id=${{ secrets.GCP_PROJECT_ID }}" \
            -var="smtp_relay_secret=${{ secrets.SMTP_RELAY_SECRET }}"
```

### `.github/workflows/canary.yml` — runs hourly

Continuously verifies the SMTP relay is alive by sending a test email end-to-end
against staging.

```yaml
name: SMTP canary

on:
  schedule:
    - cron: "0 * * * *"   # every hour
  workflow_dispatch:        # allow manual trigger

jobs:
  smtp-canary:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - working-directory: smtp
        run: bun install
      - name: Send canary email via staging proxy
        run: |
          bun smtp/scripts/canary.ts \
            --host smtp.famio.org \
            --port 587 \
            --user "testfamily@famio.org" \
            --pass "${{ secrets.SMTP_CANARY_PASSWORD }}" \
            --to "${{ secrets.SMTP_CANARY_RECIPIENT }}"
        # Exits non-zero if SMTP handshake fails or Worker returns error.
        # GitHub will mark the workflow as failed and send an email alert.
```

`smtp/scripts/canary.ts` sends a minimal email via `nodemailer`, waits for the
SMTP `250` response, and exits 0. Any failure (STARTTLS error, auth rejection,
Worker 5xx) exits 1 and GitHub notifies you.

### Required GitHub Actions secrets

| Secret | Used by |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | Worker deploy |
| `GCP_PROJECT_ID` | Terraform |
| `GCP_SA_KEY` | Terraform (service account JSON) |
| `GCP_VM_IP` | SSH deploy |
| `GCP_SSH_KEY` | SSH deploy |
| `SMTP_RELAY_SECRET` | Terraform + canary awareness |
| `SMTP_CANARY_PASSWORD` | Hourly canary |
| `SMTP_CANARY_RECIPIENT` | Hourly canary (email address to verify delivery) |
