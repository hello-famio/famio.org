// PurelyMail routing service interface + stub implementation.
// Replace stub with real PurelyMail REST API calls in V1.
//
// PurelyMail API docs: https://purelymail.com/docs/api
// Routing rules: POST /updateRoutingRule, DELETE /deleteRoutingRule

export interface CreateRouteOpts {
  addressName: string;
  domain: string;
  members: string[];  // confirmed member emails to forward to
}

export interface UpdateRouteOpts {
  addressName: string;
  domain: string;
  email: string;
}

export interface MailRoutingService {
  // Called when a family address is first created (initially 0 members until they confirm).
  createRoute(opts: CreateRouteOpts): Promise<void>;
  // Called when a member confirms their opt-in.
  addMemberToRoute(opts: UpdateRouteOpts): Promise<void>;
  // Called when a member is removed or unsubscribes.
  removeMemberFromRoute(opts: UpdateRouteOpts): Promise<void>;
}

// Stub — logs what would be sent to PurelyMail API.
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
