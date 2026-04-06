// PurelyMail routing service — real implementation + stub.
//
// PurelyMail has no "update" endpoint for routing rules, only create/delete/list.
// All mutations (add member, remove member) use an upsert pattern:
//   1. list rules to find the existing rule
//   2. delete it
//   3. recreate with updated targetAddresses
//
// Auth: single API token in Purelymail-Api-Token header.

const PURELYMAIL_BASE = "https://purelymail.com";

export interface CreateRouteOpts {
  addressName: string;
  domain: string;
  members: string[];
}

export interface UpdateRouteOpts {
  addressName: string;
  domain: string;
  email: string;
}

export interface MailRoutingService {
  // Called when a family address is first created.
  createRoute(opts: CreateRouteOpts): Promise<void>;
  // Called when a member confirms their opt-in.
  addMemberToRoute(opts: UpdateRouteOpts): Promise<void>;
  // Called when a member is removed or unsubscribes.
  removeMemberFromRoute(opts: UpdateRouteOpts): Promise<void>;
}

// ─── Real implementation ───────────────────────────────────────────────────────

interface RoutingRule {
  id: number;
  domainName: string;
  prefix: boolean;
  matchUser: string;
  targetAddresses: string[];
  catchall: boolean;
}

async function pmCall(apiKey: string, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${PURELYMAIL_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Purelymail-Api-Token": apiKey,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json() as { result?: unknown; code?: string; message?: string };

  if (!res.ok || data.code) {
    throw new Error(`Purelymail API error: ${data.message ?? `HTTP ${res.status}`}`);
  }

  return data.result;
}

async function findRule(
  apiKey: string,
  matchUser: string,
  domainName: string
): Promise<RoutingRule | undefined> {
  const result = await pmCall(apiKey, "/api/v0/listRoutingRules", {}) as { rules: RoutingRule[] };
  return result.rules.find(
    (r) => r.matchUser === matchUser && r.domainName === domainName && !r.prefix
  );
}

async function upsertRule(
  apiKey: string,
  matchUser: string,
  domainName: string,
  targetAddresses: string[]
): Promise<void> {
  // Delete existing rule if present
  const existing = await findRule(apiKey, matchUser, domainName);
  if (existing) {
    await pmCall(apiKey, "/api/v0/deleteRoutingRule", { routingRuleId: existing.id });
  }
  // Only create if there are confirmed members to forward to
  if (targetAddresses.length > 0) {
    await pmCall(apiKey, "/api/v0/createRoutingRule", {
      domainName,
      prefix: false,
      matchUser,
      targetAddresses,
      catchall: false,
    });
  }
}

export function purelyMailRoutingService(apiKey: string): MailRoutingService {
  return {
    async createRoute({ addressName, domain, members }) {
      // At signup, members are unconfirmed — no rule created until first confirm.
      await upsertRule(apiKey, addressName, domain, members);
    },

    async addMemberToRoute({ addressName, domain, email }) {
      const existing = await findRule(apiKey, addressName, domain);
      const current = existing?.targetAddresses ?? [];
      if (current.includes(email)) return; // already there
      await upsertRule(apiKey, addressName, domain, [...current, email]);
    },

    async removeMemberFromRoute({ addressName, domain, email }) {
      const existing = await findRule(apiKey, addressName, domain);
      if (!existing) return;
      const updated = existing.targetAddresses.filter((a) => a !== email);
      await upsertRule(apiKey, addressName, domain, updated);
    },
  };
}

// ─── Stub (used when PURELYMAIL_API_KEY is not set) ───────────────────────────

export function stubMailRoutingService(): MailRoutingService {
  return {
    async createRoute({ addressName, domain, members }) {
      console.log(
        `\n[PURELYMAIL] Create route\n` +
        `  Address : ${addressName}@${domain}\n` +
        `  Members : ${members.length > 0 ? members.join(", ") : "(none yet)"}\n`
      );
    },

    async addMemberToRoute({ addressName, domain, email }) {
      console.log(
        `\n[PURELYMAIL] Add to route\n` +
        `  Address : ${addressName}@${domain}\n` +
        `  Email   : ${email}\n`
      );
    },

    async removeMemberFromRoute({ addressName, domain, email }) {
      console.log(
        `\n[PURELYMAIL] Remove from route\n` +
        `  Address : ${addressName}@${domain}\n` +
        `  Email   : ${email}\n`
      );
    },
  };
}
