import {
  managePage,
  confirmPage,
  unsubscribePage,
  unsubscribeSuccessPage,
  errorPage,
} from "./templates";
import {
  type EmailService,
  resendEmailService,
  stubEmailService,
} from "./services/email";
import {
  type MailRoutingService,
  purelyMailRoutingService,
  stubMailRoutingService,
} from "./services/purelymail";

export interface Env {
  DB: D1Database;
  RESEND_API_KEY?: string;
  PURELYMAIL_API_KEY?: string;
  SMTP_RELAY_SECRET?: string;
  FAMIO_DOMAIN: string;
}

interface AppContext {
  env: Env;
  email: EmailService;
  mail: MailRoutingService;
  domain: string;
  baseUrl: string;
}

// ─── Response helpers ─────────────────────────────────────────────────────────

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Token extraction ─────────────────────────────────────────────────────────

function tokenFromRequest(request: Request, url: URL): string | null {
  const queryToken = url.searchParams.get("token");
  if (queryToken) return queryToken;
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function newId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function newToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

// ─── Password utilities (PBKDF2 via SubtleCrypto — no external deps) ─────────

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100_000;
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
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(derived)));
  return `pbkdf2:sha256:${iterations}:${saltB64}:${hashB64}`;
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const parts = hash.split(":");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") return false;
  const iterations = parseInt(parts[2]!);
  const salt = Uint8Array.from(atob(parts[3]!), (c) => c.charCodeAt(0));
  const expected = Uint8Array.from(atob(parts[4]!), (c) => c.charCodeAt(0));

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
  // Constant-time comparison to prevent timing attacks
  let diff = 0;
  for (let i = 0; i < derived8.length; i++) diff |= derived8[i]! ^ expected[i]!;
  return diff === 0;
}

// ─── D1 types ─────────────────────────────────────────────────────────────────

interface AddressRow {
  id: string;
  name: string;
  owner_email: string;
  tier: string;
  active: number;
  smtp_password_hash: string | null;
}

interface MemberRow {
  id: string;
  address_id: string;
  email: string;
  confirmed: number;
  confirmed_at: number | null;
  added_at: number;
}

interface TokenRow {
  token: string;
  address_id: string;
  type: string;
  member_email: string | null;
  expires_at: number;
  used: number;
}

async function validateToken(
  db: D1Database,
  token: string,
  type: "magic_link" | "confirm" | "unsubscribe"
): Promise<
  | { ok: false; error: string }
  | { ok: true; row: TokenRow; address: AddressRow }
> {
  const row = await db
    .prepare("SELECT * FROM tokens WHERE token = ?")
    .bind(token)
    .first<TokenRow>();

  if (!row) return { ok: false, error: "Invalid or expired link." };
  if (row.used) return { ok: false, error: "This link has already been used." };
  if (row.expires_at < Math.floor(Date.now() / 1000))
    return { ok: false, error: "This link has expired. Please request a new one." };
  if (row.type !== type) return { ok: false, error: "Invalid link type." };

  const address = await db
    .prepare("SELECT * FROM addresses WHERE id = ?")
    .bind(row.address_id)
    .first<AddressRow>();

  if (!address || !address.active)
    return { ok: false, error: "This family address no longer exists." };

  return { ok: true, row, address };
}

// ─── Main router ──────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const ctx: AppContext = {
      env,
      email: env.RESEND_API_KEY
        ? resendEmailService(env.RESEND_API_KEY)
        : stubEmailService(),
      mail: env.PURELYMAIL_API_KEY
        ? purelyMailRoutingService(env.PURELYMAIL_API_KEY)
        : stubMailRoutingService(),
      domain: env.FAMIO_DOMAIN ?? "famio.org",
      baseUrl: url.origin,
    };

    try {
      if (request.method === "POST" && url.pathname === "/signup")
        return handleSignup(request, ctx);

      if (request.method === "GET" && url.pathname === "/confirm")
        return handleConfirm(url, ctx);

      if (request.method === "GET" && url.pathname === "/manage")
        return handleManageGet(request, url, ctx);

      if (request.method === "POST" && url.pathname === "/manage/members")
        return handleAddMember(request, url, ctx);

      if (
        request.method === "DELETE" &&
        url.pathname.startsWith("/manage/members/")
      )
        return handleRemoveMember(request, url, ctx);

      if (request.method === "POST" && url.pathname === "/manage/magic-link")
        return handleResendMagicLink(request, url, ctx);

      if (request.method === "POST" && url.pathname === "/manage/smtp-password")
        return handleRegenerateSmtpPassword(request, url, ctx);

      if (request.method === "DELETE" && url.pathname === "/manage/address")
        return handleDeleteAddress(request, url, ctx);

      if (request.method === "GET" && url.pathname === "/unsubscribe")
        return handleUnsubscribeGet(url, ctx);

      if (request.method === "POST" && url.pathname === "/unsubscribe")
        return handleUnsubscribePost(url, ctx);

      if (request.method === "POST" && url.pathname === "/internal/smtp-send")
        return handleSmtpSend(request, ctx);

      if (request.method === "GET" && url.pathname === "/internal/stats")
        return handleStats(request, ctx);

      return html(
        errorPage({
          status: 404,
          title: "Not found",
          message: "The page you were looking for does not exist.",
          backUrl: "/",
        }),
        404
      );
    } catch (err) {
      console.error("Worker error:", err);
      return html(
        errorPage({
          status: 500,
          title: "Something went wrong",
          message: "An unexpected error occurred. Please try again.",
        }),
        500
      );
    }
  },
};

// ─── Route handlers ───────────────────────────────────────────────────────────

async function handleSignup(request: Request, ctx: AppContext): Promise<Response> {
  let body: { name?: string; owner_email?: string; members?: string[] };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const { name, owner_email: ownerEmail, members = [] } = body;

  if (!name || !/^[a-z0-9-]{3,30}$/.test(name)) {
    return json(
      { error: "Address name must be 3–30 characters: lowercase letters, numbers, or hyphens." },
      400
    );
  }

  const RESERVED = new Set([
    "admin", "postmaster", "abuse", "noreply", "support",
    "info", "hello", "famio",
  ]);
  if (RESERVED.has(name)) {
    return json(
      { error: `"${name}" is a reserved name. Please choose a different one.` },
      400
    );
  }

  if (!ownerEmail || !ownerEmail.includes("@")) {
    return json({ error: "A valid owner email is required." }, 400);
  }

  const validMembers = members.filter((e) => typeof e === "string" && e.includes("@"));
  const allEmails = [ownerEmail, ...validMembers];
  if (allEmails.length > 6) {
    return json({ error: "A family address supports up to 6 members total." }, 400);
  }

  const existing = await ctx.env.DB.prepare(
    "SELECT id FROM addresses WHERE name = ?"
  )
    .bind(name)
    .first();
  if (existing)
    return json(
      { error: `${name}@${ctx.domain} is already taken. Try a different name.` },
      409
    );

  const ownerExists = await ctx.env.DB.prepare(
    "SELECT id FROM addresses WHERE owner_email = ?"
  )
    .bind(ownerEmail)
    .first();
  if (ownerExists)
    return json(
      { error: "You already have a family address. Each owner can only have one." },
      409
    );

  const now = Math.floor(Date.now() / 1000);
  const addressId = newId();

  // Generate SMTP credentials
  const smtpPassword = newToken().slice(0, 32);
  const smtpHash = await hashPassword(smtpPassword);

  await ctx.env.DB.prepare(
    "INSERT INTO addresses (id, name, owner_email, tier, created_at, active, smtp_password_hash) VALUES (?, ?, ?, 'free', ?, 1, ?)"
  )
    .bind(addressId, name, ownerEmail, now, smtpHash)
    .run();

  // Owner is auto-confirmed — they just signed up, no need to confirm separately.
  const ownerNorm = ownerEmail.toLowerCase().trim();
  await ctx.env.DB.prepare(
    "INSERT INTO members (id, address_id, email, confirmed, confirmed_at, added_at) VALUES (?, ?, ?, 1, ?, ?)"
  )
    .bind(newId(), addressId, ownerNorm, now, now)
    .run();

  for (const email of validMembers) {
    await ctx.env.DB.prepare(
      "INSERT INTO members (id, address_id, email, confirmed, added_at) VALUES (?, ?, ?, 0, ?)"
    )
      .bind(newId(), addressId, email.toLowerCase().trim(), now)
      .run();
  }

  // Magic link for owner (includes SMTP password — shown once)
  const magicToken = newToken();
  await ctx.env.DB.prepare(
    "INSERT INTO tokens (token, address_id, type, expires_at, used) VALUES (?, ?, 'magic_link', ?, 0)"
  )
    .bind(magicToken, addressId, now + 7 * 24 * 60 * 60)
    .run();

  await ctx.email.sendMagicLink({
    to: ownerEmail,
    addressName: name,
    domain: ctx.domain,
    token: magicToken,
    baseUrl: ctx.baseUrl,
    smtpPassword,
  });

  // Confirmation emails for invited members only (not the owner)
  for (const email of validMembers) {
    const confirmToken = newToken();
    await ctx.env.DB.prepare(
      "INSERT INTO tokens (token, address_id, type, member_email, expires_at, used) VALUES (?, ?, 'confirm', ?, ?, 0)"
    )
      .bind(confirmToken, addressId, email.toLowerCase().trim(), now + 7 * 24 * 60 * 60)
      .run();

    await ctx.email.sendMemberConfirmation({
      to: email,
      addressName: name,
      domain: ctx.domain,
      token: confirmToken,
      baseUrl: ctx.baseUrl,
    });
  }

  // Create PurelyMail route with owner already confirmed
  await ctx.mail.createRoute({
    addressName: name,
    domain: ctx.domain,
    members: [ownerNorm],
  }).catch((err) => console.error("[PURELYMAIL] createRoute failed:", err));

  return json({ ok: true, address: `${name}@${ctx.domain}`, smtp_password: smtpPassword }, 201);
}

async function handleConfirm(url: URL, ctx: AppContext): Promise<Response> {
  const token = url.searchParams.get("token") ?? "";

  const result = await validateToken(ctx.env.DB, token, "confirm");
  if (!result.ok) {
    return html(
      confirmPage({
        ok: false,
        addressName: "your family",
        domain: ctx.domain,
        memberEmail: "",
        errorMessage: result.error,
      })
    );
  }

  const { row, address } = result;
  const memberEmail = row.member_email ?? "";

  await ctx.env.DB.prepare("UPDATE tokens SET used = 1 WHERE token = ?")
    .bind(token)
    .run();
  await ctx.env.DB.prepare(
    "UPDATE members SET confirmed = 1, confirmed_at = ? WHERE address_id = ? AND email = ?"
  )
    .bind(Math.floor(Date.now() / 1000), address.id, memberEmail)
    .run();

  await ctx.mail.addMemberToRoute({
    addressName: address.name,
    domain: ctx.domain,
    email: memberEmail,
  }).catch((err) => console.error("[PURELYMAIL] addMemberToRoute failed:", err));

  return html(
    confirmPage({
      ok: true,
      addressName: address.name,
      domain: ctx.domain,
      memberEmail,
    })
  );
}

async function handleManageGet(
  request: Request,
  url: URL,
  ctx: AppContext
): Promise<Response> {
  const token = tokenFromRequest(request, url) ?? "";

  const result = await validateToken(ctx.env.DB, token, "magic_link");
  if (!result.ok) {
    return html(
      errorPage({
        status: 401,
        title: "Link expired",
        message:
          result.error +
          " Request a new link from the person who set up your family address.",
        backUrl: "/",
      }),
      401
    );
  }

  const { address } = result;
  const members = await ctx.env.DB.prepare(
    "SELECT email, confirmed FROM members WHERE address_id = ? ORDER BY added_at ASC"
  )
    .bind(address.id)
    .all<Pick<MemberRow, "email" | "confirmed">>();

  return html(
    managePage({
      addressName: address.name,
      domain: ctx.domain,
      ownerEmail: address.owner_email,
      members: (members.results ?? []).map((m) => ({
        email: m.email,
        confirmed: m.confirmed === 1,
      })),
      token,
      smtpUsername: `${address.name}@${ctx.domain}`,
    })
  );
}

async function handleAddMember(
  request: Request,
  url: URL,
  ctx: AppContext
): Promise<Response> {
  const token = tokenFromRequest(request, url) ?? "";

  const result = await validateToken(ctx.env.DB, token, "magic_link");
  if (!result.ok) return json({ error: result.error }, 401);

  const { address } = result;

  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const email = body.email?.toLowerCase().trim();
  if (!email || !email.includes("@"))
    return json({ error: "A valid email address is required." }, 400);

  const countRow = await ctx.env.DB.prepare(
    "SELECT COUNT(*) as n FROM members WHERE address_id = ?"
  )
    .bind(address.id)
    .first<{ n: number }>();

  if ((countRow?.n ?? 0) >= 6)
    return json(
      { error: "This family address already has 6 members, which is the maximum." },
      400
    );

  const already = await ctx.env.DB.prepare(
    "SELECT id FROM members WHERE address_id = ? AND email = ?"
  )
    .bind(address.id, email)
    .first();
  if (already)
    return json(
      { error: `${email} is already a member of this address.` },
      409
    );

  const now = Math.floor(Date.now() / 1000);
  await ctx.env.DB.prepare(
    "INSERT INTO members (id, address_id, email, confirmed, added_at) VALUES (?, ?, ?, 0, ?)"
  )
    .bind(newId(), address.id, email, now)
    .run();

  const confirmToken = newToken();
  await ctx.env.DB.prepare(
    "INSERT INTO tokens (token, address_id, type, member_email, expires_at, used) VALUES (?, ?, 'confirm', ?, ?, 0)"
  )
    .bind(confirmToken, address.id, email, now + 7 * 24 * 60 * 60)
    .run();

  await ctx.email.sendMemberConfirmation({
    to: email,
    addressName: address.name,
    domain: ctx.domain,
    token: confirmToken,
    baseUrl: ctx.baseUrl,
  });

  return json({ ok: true });
}

async function handleRemoveMember(
  request: Request,
  url: URL,
  ctx: AppContext
): Promise<Response> {
  const token = tokenFromRequest(request, url) ?? "";

  const result = await validateToken(ctx.env.DB, token, "magic_link");
  if (!result.ok) return json({ error: result.error }, 401);

  const { address } = result;

  const emailEncoded = url.pathname.split("/").pop() ?? "";
  const email = decodeURIComponent(emailEncoded).toLowerCase();

  if (!email || !email.includes("@"))
    return json({ error: "Invalid email address." }, 400);

  if (email === address.owner_email)
    return json({ error: "The owner cannot be removed from the address." }, 400);

  const member = await ctx.env.DB.prepare(
    "SELECT id FROM members WHERE address_id = ? AND email = ?"
  )
    .bind(address.id, email)
    .first();
  if (!member) return json({ error: "Member not found." }, 404);

  await ctx.env.DB.prepare(
    "DELETE FROM members WHERE address_id = ? AND email = ?"
  )
    .bind(address.id, email)
    .run();

  await ctx.mail.removeMemberFromRoute({
    addressName: address.name,
    domain: ctx.domain,
    email,
  }).catch((err) => console.error("[PURELYMAIL] removeMemberFromRoute failed:", err));

  await ctx.email.notifyOwnerMemberRemoved({
    to: address.owner_email,
    memberEmail: email,
    addressName: address.name,
    domain: ctx.domain,
  });

  return json({ ok: true });
}

async function handleResendMagicLink(
  request: Request,
  url: URL,
  ctx: AppContext
): Promise<Response> {
  const token = tokenFromRequest(request, url) ?? "";

  const result = await validateToken(ctx.env.DB, token, "magic_link");
  if (!result.ok) return json({ error: result.error }, 401);

  const { address } = result;
  const now = Math.floor(Date.now() / 1000);
  const newMagicToken = newToken();

  await ctx.env.DB.prepare(
    "INSERT INTO tokens (token, address_id, type, expires_at, used) VALUES (?, ?, 'magic_link', ?, 0)"
  )
    .bind(newMagicToken, address.id, now + 7 * 24 * 60 * 60)
    .run();

  await ctx.email.sendMagicLink({
    to: address.owner_email,
    addressName: address.name,
    domain: ctx.domain,
    token: newMagicToken,
    baseUrl: ctx.baseUrl,
    // No smtpPassword on resend — they already have it from signup email
  });

  return json({ ok: true });
}

async function handleRegenerateSmtpPassword(
  request: Request,
  url: URL,
  ctx: AppContext
): Promise<Response> {
  const token = tokenFromRequest(request, url) ?? "";

  const result = await validateToken(ctx.env.DB, token, "magic_link");
  if (!result.ok) return json({ error: result.error }, 401);

  const { address } = result;
  const newPassword = newToken().slice(0, 32);
  const newHash = await hashPassword(newPassword);

  await ctx.env.DB.prepare(
    "UPDATE addresses SET smtp_password_hash = ? WHERE id = ?"
  )
    .bind(newHash, address.id)
    .run();

  return json({ ok: true, smtp_password: newPassword });
}

async function handleUnsubscribeGet(url: URL, ctx: AppContext): Promise<Response> {
  const token = url.searchParams.get("token") ?? "";

  const result = await validateToken(ctx.env.DB, token, "unsubscribe");
  if (!result.ok) {
    return html(
      errorPage({
        status: 401,
        title: "Link expired",
        message: result.error,
        backUrl: "/",
      }),
      401
    );
  }

  const { row, address } = result;
  return html(
    unsubscribePage({
      addressName: address.name,
      domain: ctx.domain,
      memberEmail: row.member_email ?? "",
      token,
    })
  );
}

async function handleUnsubscribePost(url: URL, ctx: AppContext): Promise<Response> {
  const token = url.searchParams.get("token") ?? "";

  const result = await validateToken(ctx.env.DB, token, "unsubscribe");
  if (!result.ok) {
    return html(
      errorPage({
        status: 401,
        title: "Link expired",
        message: result.error,
        backUrl: "/",
      }),
      401
    );
  }

  const { row, address } = result;
  const memberEmail = row.member_email ?? "";

  await ctx.env.DB.prepare("UPDATE tokens SET used = 1 WHERE token = ?")
    .bind(token)
    .run();
  await ctx.env.DB.prepare(
    "DELETE FROM members WHERE address_id = ? AND email = ?"
  )
    .bind(address.id, memberEmail)
    .run();

  await ctx.mail.removeMemberFromRoute({
    addressName: address.name,
    domain: ctx.domain,
    email: memberEmail,
  }).catch((err) => console.error("[PURELYMAIL] removeMemberFromRoute failed:", err));

  await ctx.email.notifyOwnerMemberUnsubscribed({
    to: address.owner_email,
    memberEmail,
    addressName: address.name,
    domain: ctx.domain,
  });

  return html(
    unsubscribeSuccessPage({
      addressName: address.name,
      domain: ctx.domain,
      memberEmail,
    })
  );
}

async function handleDeleteAddress(
  request: Request,
  url: URL,
  ctx: AppContext
): Promise<Response> {
  const token = tokenFromRequest(request, url) ?? "";

  const result = await validateToken(ctx.env.DB, token, "magic_link");
  if (!result.ok) return json({ error: result.error }, 401);

  const { address } = result;

  const confirmed = await ctx.env.DB.prepare(
    "SELECT email FROM members WHERE address_id = ? AND confirmed = 1"
  )
    .bind(address.id)
    .all<{ email: string }>();

  for (const member of confirmed.results ?? []) {
    await ctx.mail.removeMemberFromRoute({
      addressName: address.name,
      domain: ctx.domain,
      email: member.email,
    }).catch((err) => console.error("[PURELYMAIL] removeMemberFromRoute failed:", err));
  }

  await ctx.env.DB.prepare("DELETE FROM tokens WHERE address_id = ?").bind(address.id).run();
  await ctx.env.DB.prepare("DELETE FROM members WHERE address_id = ?").bind(address.id).run();
  await ctx.env.DB.prepare("DELETE FROM addresses WHERE id = ?").bind(address.id).run();

  return json({ ok: true });
}

async function handleSmtpSend(request: Request, ctx: AppContext): Promise<Response> {
  // Verify the shared secret so only our GCP proxy can call this endpoint.
  const secret = request.headers.get("X-Relay-Secret");
  if (!secret || !ctx.env.SMTP_RELAY_SECRET || secret !== ctx.env.SMTP_RELAY_SECRET) {
    return json({ error: "Forbidden." }, 403);
  }

  let body: {
    username?: string;
    password?: string;
    raw_message_b64?: string;
    envelope_from?: string;
    envelope_to?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const { username, password, raw_message_b64, envelope_from, envelope_to } = body;
  if (!username || !password || !raw_message_b64 || !envelope_to?.length) {
    return json({ error: "Missing required fields." }, 400);
  }

  // username is the full address e.g. "smiths@famio.org" — extract name part
  const name = username.split("@")[0]!.toLowerCase();

  const address = await ctx.env.DB.prepare(
    "SELECT * FROM addresses WHERE name = ? AND active = 1"
  )
    .bind(name)
    .first<AddressRow>();

  if (!address?.smtp_password_hash) {
    return json({ error: "Invalid credentials." }, 401);
  }

  const valid = await verifyPassword(password, address.smtp_password_hash);
  if (!valid) {
    return json({ error: "Invalid credentials." }, 401);
  }

  // Decode base64 → binary string → pass to postal-mime via email service
  const rawMessage = atob(raw_message_b64);

  await ctx.email.sendOutboundWithFooter({
    rawMessage,
    envelopeFrom: envelope_from ?? username,
    envelopeTo: envelope_to,
    addressName: address.name,
    domain: ctx.domain,
    tier: address.tier,
  });

  return json({ ok: true });
}

async function handleStats(request: Request, ctx: AppContext): Promise<Response> {
  const secret = request.headers.get("X-Relay-Secret");
  if (!secret || !ctx.env.SMTP_RELAY_SECRET || secret !== ctx.env.SMTP_RELAY_SECRET) {
    return json({ error: "Forbidden." }, 403);
  }

  const [addresses, confirmed, pending] = await Promise.all([
    ctx.env.DB.prepare("SELECT COUNT(*) as n FROM addresses WHERE active = 1").first<{ n: number }>(),
    ctx.env.DB.prepare("SELECT COUNT(*) as n FROM members WHERE confirmed = 1").first<{ n: number }>(),
    ctx.env.DB.prepare("SELECT COUNT(*) as n FROM members WHERE confirmed = 0").first<{ n: number }>(),
  ]);

  return json({
    addresses: addresses?.n ?? 0,
    members_confirmed: confirmed?.n ?? 0,
    members_pending: pending?.n ?? 0,
  });
}
