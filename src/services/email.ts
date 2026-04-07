// Email service — real Resend implementation + stub.
//
// Resend API docs: https://resend.com/docs/api-reference/emails/send-email
// Auth: Bearer token in Authorization header.
// From address requires a verified domain in your Resend account.

const RESEND_BASE = "https://api.resend.com";
const FROM = "Famio <hello@famio.org>";

export interface SendMagicLinkOpts {
  to: string;
  addressName: string;
  domain: string;
  token: string;
  baseUrl: string;
}

export interface SendConfirmationOpts {
  to: string;
  addressName: string;
  domain: string;
  token: string;
  baseUrl: string;
}

export interface NotifyOwnerOpts {
  to: string;
  memberEmail: string;
  addressName: string;
  domain: string;
}

export interface EmailService {
  sendMagicLink(opts: SendMagicLinkOpts): Promise<void>;
  sendMemberConfirmation(opts: SendConfirmationOpts): Promise<void>;
  notifyOwnerMemberRemoved(opts: NotifyOwnerOpts): Promise<void>;
  notifyOwnerMemberUnsubscribed(opts: NotifyOwnerOpts): Promise<void>;
}

// ─── Real implementation ───────────────────────────────────────────────────────

async function resendSend(
  apiKey: string,
  to: string,
  subject: string,
  html: string
): Promise<void> {
  const res = await fetch(`${RESEND_BASE}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error ${res.status}: ${err}`);
  }
}

function emailBase(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f7fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#2d3748;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7fafc;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

        <!-- Header -->
        <tr><td style="padding-bottom:24px;text-align:center;">
          <span style="font-size:1.6rem;font-weight:800;background:linear-gradient(135deg,#ff6b9d,#4ecdc4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">Famio</span>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:white;border-radius:16px;padding:36px 32px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          ${body}
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding-top:24px;text-align:center;font-size:0.8rem;color:#a0aec0;">
          Famio · family email, simplified · <a href="https://famio.org" style="color:#4ecdc4;text-decoration:none;">famio.org</a>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function ctaButton(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;margin-top:24px;padding:14px 28px;background:linear-gradient(135deg,#ff6b9d,#4ecdc4);color:white;font-weight:700;font-size:1rem;text-decoration:none;border-radius:50px;">${label}</a>`;
}

export function resendEmailService(apiKey: string): EmailService {
  return {
    async sendMagicLink({ to, addressName, domain, token, baseUrl }) {
      const link = `${baseUrl}/manage?token=${token}`;
      const address = `${addressName}@${domain}`;
      const html = emailBase(
        `Manage ${address}`,
        `<h1 style="font-size:1.3rem;font-weight:700;color:#2d3748;margin-bottom:8px;">Your family address is ready</h1>
        <p style="color:#4a5568;margin-bottom:4px;">Click below to manage <strong>${address}</strong> — add or remove members, resend invitations, and more.</p>
        <p style="color:#a0aec0;font-size:0.85rem;">This link is personal to you. Don't share it.</p>
        <div style="text-align:center;">${ctaButton(link, "Manage family address")}</div>
        <p style="margin-top:24px;font-size:0.8rem;color:#a0aec0;">Link expires in 7 days. If you didn't sign up for Famio, you can ignore this email.</p>`
      );
      await resendSend(apiKey, to, `Manage ${address}`, html);
    },

    async sendMemberConfirmation({ to, addressName, domain, token, baseUrl }) {
      const link = `${baseUrl}/confirm?token=${token}`;
      const address = `${addressName}@${domain}`;
      const html = emailBase(
        `You've been added to ${address}`,
        `<h1 style="font-size:1.3rem;font-weight:700;color:#2d3748;margin-bottom:8px;">You've been added to ${address}</h1>
        <p style="color:#4a5568;margin-bottom:4px;">Emails sent to <strong>${address}</strong> will be forwarded to you. Click below to confirm you'd like to receive them.</p>
        <div style="text-align:center;">${ctaButton(link, "Confirm membership")}</div>
        <p style="margin-top:24px;font-size:0.8rem;color:#a0aec0;">Link expires in 7 days. If you weren't expecting this, you can ignore it — you won't receive any emails until you confirm.</p>`
      );
      await resendSend(apiKey, to, `You've been added to ${address}`, html);
    },

    async notifyOwnerMemberRemoved({ to, memberEmail, addressName, domain }) {
      const address = `${addressName}@${domain}`;
      const html = emailBase(
        `Member removed from ${address}`,
        `<h1 style="font-size:1.3rem;font-weight:700;color:#2d3748;margin-bottom:8px;">Member removed</h1>
        <p style="color:#4a5568;"><strong>${memberEmail}</strong> has been removed from <strong>${address}</strong> and will no longer receive forwarded emails.</p>`
      );
      await resendSend(apiKey, to, `Member removed from ${address}`, html);
    },

    async notifyOwnerMemberUnsubscribed({ to, memberEmail, addressName, domain }) {
      const address = `${addressName}@${domain}`;
      const html = emailBase(
        `Member unsubscribed from ${address}`,
        `<h1 style="font-size:1.3rem;font-weight:700;color:#2d3748;margin-bottom:8px;">Member unsubscribed</h1>
        <p style="color:#4a5568;"><strong>${memberEmail}</strong> has unsubscribed from <strong>${address}</strong> and will no longer receive forwarded emails.</p>`
      );
      await resendSend(apiKey, to, `Member unsubscribed from ${address}`, html);
    },
  };
}

// ─── Stub (used when RESEND_API_KEY is not set) ────────────────────────────────

export function stubEmailService(): EmailService {
  return {
    async sendMagicLink({ to, addressName, domain, token, baseUrl }) {
      const link = `${baseUrl}/manage?token=${token}`;
      console.log(
        `\n[EMAIL] Magic link → ${to}\n` +
        `  Address : ${addressName}@${domain}\n` +
        `  Link    : ${link}\n`
      );
    },

    async sendMemberConfirmation({ to, addressName, domain, token, baseUrl }) {
      const link = `${baseUrl}/confirm?token=${token}`;
      console.log(
        `\n[EMAIL] Confirmation → ${to}\n` +
        `  Address : ${addressName}@${domain}\n` +
        `  Link    : ${link}\n`
      );
    },

    async notifyOwnerMemberRemoved({ to, memberEmail, addressName, domain }) {
      console.log(
        `\n[EMAIL] Member removed notice → ${to}\n` +
        `  Removed : ${memberEmail} from ${addressName}@${domain}\n`
      );
    },

    async notifyOwnerMemberUnsubscribed({ to, memberEmail, addressName, domain }) {
      console.log(
        `\n[EMAIL] Unsubscribe notice → ${to}\n` +
        `  Removed : ${memberEmail} from ${addressName}@${domain}\n`
      );
    },
  };
}
