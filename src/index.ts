import {
  managePage,
  confirmPage,
  unsubscribePage,
  unsubscribeSuccessPage,
  errorPage,
} from "./templates";
import {
  type EmailService,
  stubEmailService,
} from "./services/email";
import {
  type MailRoutingService,
  purelyMailRoutingService,
  stubMailRoutingService,
} from "./services/purelymail";

export interface Env {
  DB: D1Database;
  PURELYMAIL_API_KEY?: string;
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

// ─── D1 types ─────────────────────────────────────────────────────────────────

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
      email: stubEmailService(),
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

      if (request.method === "GET" && url.pathname === "/unsubscribe")
        return handleUnsubscribeGet(url, ctx);

      if (request.method === "POST" && url.pathname === "/unsubscribe")
        return handleUnsubscribePost(url, ctx);

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

  await ctx.env.DB.prepare(
    "INSERT INTO addresses (id, name, owner_email, tier, created_at, active) VALUES (?, ?, ?, 'free', ?, 1)"
  )
    .bind(addressId, name, ownerEmail, now)
    .run();

  for (const email of allEmails) {
    await ctx.env.DB.prepare(
      "INSERT INTO members (id, address_id, email, confirmed, added_at) VALUES (?, ?, ?, 0, ?)"
    )
      .bind(newId(), addressId, email.toLowerCase().trim(), now)
      .run();
  }

  // Magic link for owner
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
  });

  // Confirmation tokens for all members
  for (const email of allEmails) {
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

  // Create PurelyMail route (empty until members confirm)
  await ctx.mail.createRoute({
    addressName: name,
    domain: ctx.domain,
    members: [],
  });

  return json({ ok: true, address: `${name}@${ctx.domain}` }, 201);
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
  });

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
  });

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
  });

  return json({ ok: true });
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
  });

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
