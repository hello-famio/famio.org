// Email service — real Resend implementation + stub.
//
// Resend API docs: https://resend.com/docs/api-reference/emails/send-email
// Auth: Bearer token in Authorization header.
// From address requires a verified domain in your Resend account.

import PostalMime from "postal-mime";

const RESEND_BASE = "https://api.resend.com";
const FROM_TRANSACTIONAL = "Famio <hello@famio.org>";

// ─── Footer injection (exported for unit testing) ────────────────────────────

export function injectTextFooter(
  text: string | null | undefined,
  addressName: string,
  domain: string
): string | undefined {
  if (!text) return undefined;
  return text + `\n\n--\nSent via ${addressName}@${domain} · Get your own family address at famio.org`;
}

export function injectHtmlFooter(
  html: string | null | undefined,
  addressName: string,
  domain: string
): string | undefined {
  if (!html) return undefined;
  const footer = `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:0.8rem;color:#a0aec0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Sent via <strong>${addressName}@${domain}</strong> &middot; <a href="https://famio.org" style="color:#4ecdc4;text-decoration:none;">Get your own family address</a></div>`;
  if (html.includes("</body>")) {
    return html.replace("</body>", `${footer}</body>`);
  }
  return html + footer;
}

// ─── Resend API ───────────────────────────────────────────────────────────────

interface ResendSendOpts {
  from?: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: string }>; // content is base64
}

async function resendSend(apiKey: string, opts: ResendSendOpts): Promise<void> {
  const payload: Record<string, unknown> = {
    from: opts.from ?? FROM_TRANSACTIONAL,
    to: Array.isArray(opts.to) ? opts.to : [opts.to],
    subject: opts.subject,
  };
  if (opts.html) payload.html = opts.html;
  if (opts.text) payload.text = opts.text;
  if (opts.replyTo) payload.reply_to = opts.replyTo;
  if (opts.attachments?.length) payload.attachments = opts.attachments;

  const res = await fetch(`${RESEND_BASE}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error ${res.status}: ${err}`);
  }
}

// ─── Service interface ────────────────────────────────────────────────────────

export interface SendMagicLinkOpts {
  to: string;
  addressName: string;
  domain: string;
  token: string;
  baseUrl: string;
  smtpPassword?: string; // shown once in signup email; omitted on resend
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

export interface SendOutboundOpts {
  rawMessage: string;       // raw MIME from proxy, decoded from base64
  envelopeFrom: string;     // SMTP MAIL FROM
  envelopeTo: string[];     // SMTP RCPT TO
  addressName: string;
  domain: string;
  tier: string;             // "no_footer" skips injection
}

export interface EmailService {
  sendMagicLink(opts: SendMagicLinkOpts): Promise<void>;
  sendMemberConfirmation(opts: SendConfirmationOpts): Promise<void>;
  notifyOwnerMemberRemoved(opts: NotifyOwnerOpts): Promise<void>;
  notifyOwnerMemberUnsubscribed(opts: NotifyOwnerOpts): Promise<void>;
  sendOutboundWithFooter(opts: SendOutboundOpts): Promise<void>;
}

// ─── Email templates ──────────────────────────────────────────────────────────

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
          Famio &middot; family email, simplified &middot; <a href="https://famio.org" style="color:#4ecdc4;text-decoration:none;">famio.org</a>
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

function smtpCredentialsBlock(address: string, password: string): string {
  return `
  <div style="margin-top:24px;padding:16px 20px;background:#f7fafc;border-radius:10px;border:1px solid #e2e8f0;">
    <p style="font-size:0.9rem;font-weight:600;color:#2d3748;margin:0 0 10px 0;">Send email as ${address}</p>
    <p style="font-size:0.82rem;color:#718096;margin:0 0 12px 0;">Add these settings to Gmail or Outlook to send from your family address:</p>
    <table cellpadding="0" cellspacing="0" style="font-size:0.85rem;width:100%">
      <tr><td style="color:#a0aec0;padding:3px 12px 3px 0;white-space:nowrap">SMTP host</td><td style="font-family:monospace;color:#2d3748">smtp.famio.org</td></tr>
      <tr><td style="color:#a0aec0;padding:3px 12px 3px 0">Port</td><td style="font-family:monospace;color:#2d3748">587</td></tr>
      <tr><td style="color:#a0aec0;padding:3px 12px 3px 0">Username</td><td style="font-family:monospace;color:#2d3748">${address}</td></tr>
      <tr><td style="color:#a0aec0;padding:3px 12px 3px 0">Password</td><td style="font-family:monospace;color:#2d3748">${password}</td></tr>
    </table>
    <p style="font-size:0.78rem;color:#a0aec0;margin:10px 0 0 0">Save this password — it won't be shown again. You can regenerate it from your manage page.</p>
  </div>`;
}

// ─── Real implementation ──────────────────────────────────────────────────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function resendEmailService(apiKey: string): EmailService {
  return {
    async sendMagicLink({ to, addressName, domain, token, baseUrl, smtpPassword }) {
      const link = `${baseUrl}/manage?token=${token}`;
      const address = `${addressName}@${domain}`;
      const smtpBlock = smtpPassword ? smtpCredentialsBlock(address, smtpPassword) : "";
      const html = emailBase(
        `Manage ${address}`,
        `<h1 style="font-size:1.3rem;font-weight:700;color:#2d3748;margin-bottom:8px;">Your family address is ready</h1>
        <p style="color:#4a5568;margin-bottom:4px;">Click below to manage <strong>${address}</strong> — add or remove members, resend invitations, and more.</p>
        <p style="color:#a0aec0;font-size:0.85rem;">This link is personal to you. Don't share it.</p>
        <div style="text-align:center;">${ctaButton(link, "Manage family address")}</div>
        ${smtpBlock}
        <p style="margin-top:24px;font-size:0.8rem;color:#a0aec0;">Link expires in 7 days. If you didn't sign up for Famio, you can ignore this email.</p>`
      );
      await resendSend(apiKey, { to, subject: `Manage ${address}`, html });
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
      await resendSend(apiKey, { to, subject: `You've been added to ${address}`, html });
    },

    async notifyOwnerMemberRemoved({ to, memberEmail, addressName, domain }) {
      const address = `${addressName}@${domain}`;
      const html = emailBase(
        `Member removed from ${address}`,
        `<h1 style="font-size:1.3rem;font-weight:700;color:#2d3748;margin-bottom:8px;">Member removed</h1>
        <p style="color:#4a5568;"><strong>${memberEmail}</strong> has been removed from <strong>${address}</strong> and will no longer receive forwarded emails.</p>`
      );
      await resendSend(apiKey, { to, subject: `Member removed from ${address}`, html });
    },

    async notifyOwnerMemberUnsubscribed({ to, memberEmail, addressName, domain }) {
      const address = `${addressName}@${domain}`;
      const html = emailBase(
        `Member unsubscribed from ${address}`,
        `<h1 style="font-size:1.3rem;font-weight:700;color:#2d3748;margin-bottom:8px;">Member unsubscribed</h1>
        <p style="color:#4a5568;"><strong>${memberEmail}</strong> has unsubscribed from <strong>${address}</strong> and will no longer receive forwarded emails.</p>`
      );
      await resendSend(apiKey, { to, subject: `Member unsubscribed from ${address}`, html });
    },

    async sendOutboundWithFooter({ rawMessage, envelopeTo, addressName, domain, tier }) {
      const rawBytes = Uint8Array.from(rawMessage, (c) => c.charCodeAt(0));
      const parsed = await new PostalMime().parse(rawBytes.buffer);

      const injectFooter = tier !== "no_footer";

      const text = injectFooter
        ? injectTextFooter(parsed.text, addressName, domain)
        : (parsed.text ?? undefined);

      const html = injectFooter
        ? injectHtmlFooter(parsed.html, addressName, domain)
        : (parsed.html ?? undefined);

      const attachments = (parsed.attachments ?? []).map((a) => ({
        filename: a.filename ?? "attachment",
        content: arrayBufferToBase64(a.content as ArrayBuffer),
      }));

      const replyTo = parsed.replyTo?.[0]?.address;

      await resendSend(apiKey, {
        from: `${addressName}@${domain}`,
        to: envelopeTo,
        subject: parsed.subject ?? "(no subject)",
        text,
        html,
        replyTo,
        attachments: attachments.length ? attachments : undefined,
      });
    },
  };
}

// ─── Stub (used when RESEND_API_KEY is not set) ────────────────────────────────

export function stubEmailService(): EmailService {
  return {
    async sendMagicLink({ to, addressName, domain, token, baseUrl, smtpPassword }) {
      const link = `${baseUrl}/manage?token=${token}`;
      console.log(
        `\n[EMAIL] Magic link → ${to}\n` +
        `  Address : ${addressName}@${domain}\n` +
        `  Link    : ${link}\n` +
        (smtpPassword ? `  SMTP pw : ${smtpPassword}\n` : "")
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

    async sendOutboundWithFooter({ rawMessage, envelopeTo, addressName, domain }) {
      console.log(
        `\n[EMAIL] Outbound send → ${envelopeTo.join(", ")}\n` +
        `  From    : ${addressName}@${domain}\n` +
        `  Bytes   : ${rawMessage.length}\n`
      );
    },
  };
}
