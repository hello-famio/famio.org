// Email service interface + stub implementation.
// Replace stub with real Resend/PurelyMail SMTP calls in V1.5.

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

// Stub — logs links to console so you can click them during local dev.
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
