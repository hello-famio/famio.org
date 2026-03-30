import {
  managePage,
  confirmPage,
  unsubscribePage,
  unsubscribeSuccessPage,
  errorPage,
} from "./templates";

export interface Env {
  DB: D1Database;
  PURELYMAIL_API_KEY: string;
  PURELYMAIL_ACCOUNT_TOKEN: string;
  FAMIO_DOMAIN: string;
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
  // GET requests carry token as query param
  const queryToken = url.searchParams.get("token");
  if (queryToken) return queryToken;
  // Mutation requests carry token in Authorization header
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

// ─── D1 helpers ───────────────────────────────────────────────────────────────

interface AddressRow {
  id: string;
  name: string;
  owner_email: string;
  tier: string;
  active: number;
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
): Promise<{ ok: false; error: string } | { ok: true; row: TokenRow; address: AddressRow }> {
  const row = await db
    .prepare("SELECT * FROM tokens WHERE token = ?")
    .bind(token)
    .first<TokenRow>();

  if (!row) return { ok: false, error: "Invalid or expired link." };
  if (row.used) return { ok: false, error: "This link has already been used." };
  if (row.expires_at < Math.floor(Date.now() / 1000))
    return { ok: false, error: "This link has expired. Please request a new one." };
  if (row.type !== type)
    return { ok: false, error: "Invalid link type." };

  const address = await db
    .prepare("SELECT * FROM addresses WHERE id = ?")
    .bind(row.address_id)
    .first<AddressRow>();

  if (!address || !address.active)
    return { ok: false, error: "This family address no longer exists." };

  return { ok: true, row, address };
}

function nanoid(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "";
  for (let i = 0; i < 21; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// ─── Main router ──────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const domain = env.FAMIO_DOMAIN ?? "famio.org";

    try {
      // POST /signup — create family address
      if (request.method === "POST" && url.pathname === "/signup") {
        return handleSignup(request, env, domain);
      }

      // GET /confirm?token= — member opt-in confirmation
      if (request.method === "GET" && url.pathname === "/confirm") {
        return handleConfirm(url, env, domain);
      }

      // GET /manage?token= — owner roster management page
      if (request.method === "GET" && url.pathname === "/manage") {
        return handleManageGet(request, url, env, domain);
      }

      // POST /manage/members — add member
      if (request.method === "POST" && url.pathname === "/manage/members") {
        return handleAddMember(request, url, env);
      }

      // DELETE /manage/members/:email — remove member
      if (request.method === "DELETE" && url.pathname.startsWith("/manage/members/")) {
        return handleRemoveMember(request, url, env);
      }

      // POST /manage/magic-link — resend magic link
      if (request.method === "POST" && url.pathname === "/manage/magic-link") {
        return handleResendMagicLink(request, url, env);
      }

      // GET /unsubscribe?token= — show confirmation page before unsubscribing
      if (request.method === "GET" && url.pathname === "/unsubscribe") {
        return handleUnsubscribeGet(url, env, domain);
      }

      // POST /unsubscribe?token= — member self-removes
      if (request.method === "POST" && url.pathname === "/unsubscribe") {
        return handleUnsubscribePost(url, env, domain);
      }

      return html(
        errorPage({ status: 404, title: "Not found", message: "The page you were looking for does not exist.", backUrl: "/" }),
        404
      );
    } catch (err) {
      console.error("Worker error:", err);
      return html(
        errorPage({ status: 500, title: "Something went wrong", message: "An unexpected error occurred. Please try again." }),
        500
      );
    }
  },
};

// ─── Route handlers ───────────────────────────────────────────────────────────

async function handleSignup(request: Request, env: Env, domain: string): Promise<Response> {
  let body: { name?: string; owner_email?: string; members?: string[] };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const { name, owner_email: ownerEmail, members = [] } = body;

  if (!name || !/^[a-z0-9-]{3,30}$/.test(name)) {
    return json({ error: "Address name must be 3–30 characters: lowercase letters, numbers, or hyphens." }, 400);
  }

  const RESERVED = new Set(["admin", "postmaster", "abuse", "noreply", "support", "info", "hello", "famio"]);
  if (RESERVED.has(name)) {
    return json({ error: `"${name}" is a reserved name. Please choose a different one.` }, 400);
  }

  if (!ownerEmail || !ownerEmail.includes("@")) {
    return json({ error: "A valid owner email is required." }, 400);
  }

  const allEmails = [ownerEmail, ...members.filter((e) => e && e.includes("@"))];
  if (allEmails.length > 6) {
    return json({ error: "A family address supports up to 6 members." }, 400);
  }

  // Check for duplicate name
  const existing = await env.DB.prepare("SELECT id FROM addresses WHERE name = ?")
    .bind(name)
    .first();
  if (existing) {
    return json({ error: `${name}@${domain} is already taken. Try a different name.` }, 409);
  }

  // Check for duplicate owner
  const ownerExists = await env.DB.prepare("SELECT id FROM addresses WHERE owner_email = ?")
    .bind(ownerEmail)
    .first();
  if (ownerExists) {
    return json({ error: "You already have a family address. Each owner can only have one." }, 409);
  }

  const now = Math.floor(Date.now() / 1000);
  const addressId = nanoid();

  await env.DB.prepare(
    "INSERT INTO addresses (id, name, owner_email, tier, created_at, active) VALUES (?, ?, ?, 'free', ?, 1)"
  )
    .bind(addressId, name, ownerEmail, now)
    .run();

  // Insert all members (unconfirmed)
  for (const email of allEmails) {
    await env.DB.prepare(
      "INSERT INTO members (id, address_id, email, confirmed, added_at) VALUES (?, ?, ?, 0, ?)"
    )
      .bind(nanoid(), addressId, email.toLowerCase().trim(), now)
      .run();
  }

  // Create magic link token for owner
  const magicToken = nanoid() + nanoid();
  await env.DB.prepare(
    "INSERT INTO tokens (token, address_id, type, expires_at, used) VALUES (?, ?, 'magic_link', ?, 0)"
  )
    .bind(magicToken, addressId, now + 7 * 24 * 60 * 60)
    .run();

  // TODO: send owner magic link email + member confirmation emails via PurelyMail
  // TODO: create PurelyMail routing rule for ${name}@${domain}
  console.log(`[signup] created ${name}@${domain}, magic link token: ${magicToken}`);

  return json({ ok: true, address: `${name}@${domain}` }, 201);
}

async function handleConfirm(url: URL, env: Env, domain: string): Promise<Response> {
  const token = url.searchParams.get("token") ?? "";

  const result = await validateToken(env.DB, token, "confirm");
  if (!result.ok) {
    return html(
      confirmPage({
        ok: false,
        addressName: "your family",
        domain,
        memberEmail: "",
        errorMessage: result.error,
      })
    );
  }

  const { row, address } = result;
  const memberEmail = row.member_email ?? "";

  // Mark token as used
  await env.DB.prepare("UPDATE tokens SET used = 1 WHERE token = ?").bind(token).run();

  // Confirm the member
  await env.DB.prepare(
    "UPDATE members SET confirmed = 1, confirmed_at = ? WHERE address_id = ? AND email = ?"
  )
    .bind(Math.floor(Date.now() / 1000), address.id, memberEmail)
    .run();

  // TODO: update PurelyMail routing rule to add confirmed member

  return html(
    confirmPage({
      ok: true,
      addressName: address.name,
      domain,
      memberEmail,
    })
  );
}

async function handleManageGet(
  request: Request,
  url: URL,
  env: Env,
  domain: string
): Promise<Response> {
  const token = tokenFromRequest(request, url) ?? "";

  const result = await validateToken(env.DB, token, "magic_link");
  if (!result.ok) {
    return html(
      errorPage({
        status: 401,
        title: "Link expired",
        message: result.error + " Request a new link from the person who set up your family address.",
        backUrl: "/",
      }),
      401
    );
  }

  const { address } = result;

  const members = await env.DB.prepare(
    "SELECT email, confirmed FROM members WHERE address_id = ? ORDER BY added_at ASC"
  )
    .bind(address.id)
    .all<Pick<MemberRow, "email" | "confirmed">>();

  return html(
    managePage({
      addressName: address.name,
      domain,
      ownerEmail: address.owner_email,
      members: (members.results ?? []).map((m) => ({
        email: m.email,
        confirmed: m.confirmed === 1,
      })),
      token,
    })
  );
}

async function handleAddMember(request: Request, url: URL, env: Env): Promise<Response> {
  const token = tokenFromRequest(request, url) ?? "";

  const result = await validateToken(env.DB, token, "magic_link");
  if (!result.ok) return json({ error: result.error }, 401);

  const { address } = result;

  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const email = body.email?.toLowerCase().trim();
  if (!email || !email.includes("@")) {
    return json({ error: "A valid email address is required." }, 400);
  }

  // Count current members
  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) as n FROM members WHERE address_id = ?"
  )
    .bind(address.id)
    .first<{ n: number }>();

  if ((countRow?.n ?? 0) >= 6) {
    return json({ error: "This family address already has 6 members, which is the maximum." }, 400);
  }

  // Check if already a member
  const already = await env.DB.prepare(
    "SELECT id FROM members WHERE address_id = ? AND email = ?"
  )
    .bind(address.id, email)
    .first();

  if (already) {
    return json({ error: `${email} is already a member of this address.` }, 409);
  }

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    "INSERT INTO members (id, address_id, email, confirmed, added_at) VALUES (?, ?, ?, 0, ?)"
  )
    .bind(nanoid(), address.id, email, now)
    .run();

  // Create confirmation token
  const confirmToken = nanoid() + nanoid();
  await env.DB.prepare(
    "INSERT INTO tokens (token, address_id, type, member_email, expires_at, used) VALUES (?, ?, 'confirm', ?, ?, 0)"
  )
    .bind(confirmToken, address.id, email, now + 7 * 24 * 60 * 60)
    .run();

  // TODO: send confirmation email to member
  console.log(`[add-member] ${email} added to ${address.name}, confirm token: ${confirmToken}`);

  return json({ ok: true });
}

async function handleRemoveMember(request: Request, url: URL, env: Env): Promise<Response> {
  const token = tokenFromRequest(request, url) ?? "";

  const result = await validateToken(env.DB, token, "magic_link");
  if (!result.ok) return json({ error: result.error }, 401);

  const { address } = result;

  const emailEncoded = url.pathname.split("/").pop() ?? "";
  const email = decodeURIComponent(emailEncoded).toLowerCase();

  if (!email || !email.includes("@")) {
    return json({ error: "Invalid email address." }, 400);
  }

  if (email === address.owner_email) {
    return json({ error: "The owner cannot be removed from the address." }, 400);
  }

  const member = await env.DB.prepare(
    "SELECT id FROM members WHERE address_id = ? AND email = ?"
  )
    .bind(address.id, email)
    .first();

  if (!member) {
    return json({ error: "Member not found." }, 404);
  }

  await env.DB.prepare("DELETE FROM members WHERE address_id = ? AND email = ?")
    .bind(address.id, email)
    .run();

  // TODO: remove from PurelyMail routing rule
  // TODO: notify owner by email

  return json({ ok: true });
}

async function handleResendMagicLink(request: Request, url: URL, env: Env): Promise<Response> {
  const token = tokenFromRequest(request, url) ?? "";

  const result = await validateToken(env.DB, token, "magic_link");
  if (!result.ok) return json({ error: result.error }, 401);

  const { address } = result;
  const now = Math.floor(Date.now() / 1000);

  const newToken = nanoid() + nanoid();
  await env.DB.prepare(
    "INSERT INTO tokens (token, address_id, type, expires_at, used) VALUES (?, ?, 'magic_link', ?, 0)"
  )
    .bind(newToken, address.id, now + 7 * 24 * 60 * 60)
    .run();

  // TODO: send magic link email to owner
  console.log(`[magic-link] new token for ${address.name}: ${newToken}`);

  return json({ ok: true });
}

async function handleUnsubscribeGet(url: URL, env: Env, domain: string): Promise<Response> {
  const token = url.searchParams.get("token") ?? "";

  const result = await validateToken(env.DB, token, "unsubscribe");
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

  return html(
    unsubscribePage({
      addressName: address.name,
      domain,
      memberEmail,
      token,
    })
  );
}

async function handleUnsubscribePost(url: URL, env: Env, domain: string): Promise<Response> {
  const token = url.searchParams.get("token") ?? "";

  const result = await validateToken(env.DB, token, "unsubscribe");
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

  await env.DB.prepare("UPDATE tokens SET used = 1 WHERE token = ?").bind(token).run();
  await env.DB.prepare("DELETE FROM members WHERE address_id = ? AND email = ?")
    .bind(address.id, memberEmail)
    .run();

  // TODO: remove from PurelyMail routing rule
  // TODO: notify owner by email

  return html(
    unsubscribeSuccessPage({
      addressName: address.name,
      domain,
      memberEmail,
    })
  );
}
