export interface Env {
  DB: D1Database;
  PURELYMAIL_API_KEY: string;
  PURELYMAIL_ACCOUNT_TOKEN: string;
  FAMIO_DOMAIN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // POST /signup — create family address
    if (request.method === "POST" && url.pathname === "/signup") {
      return new Response("Not implemented", { status: 501 });
    }

    // GET /confirm?token= — member opt-in confirmation
    if (request.method === "GET" && url.pathname === "/confirm") {
      return new Response("Not implemented", { status: 501 });
    }

    // GET /manage?token= — owner roster management page
    if (request.method === "GET" && url.pathname === "/manage") {
      return new Response("Not implemented", { status: 501 });
    }

    // POST /manage/members — add member
    if (request.method === "POST" && url.pathname === "/manage/members") {
      return new Response("Not implemented", { status: 501 });
    }

    // DELETE /manage/members/:email — remove member
    if (request.method === "DELETE" && url.pathname.startsWith("/manage/members/")) {
      return new Response("Not implemented", { status: 501 });
    }

    // POST /manage/magic-link — resend magic link
    if (request.method === "POST" && url.pathname === "/manage/magic-link") {
      return new Response("Not implemented", { status: 501 });
    }

    // POST /unsubscribe?token= — member self-remove
    if (request.method === "POST" && url.pathname === "/unsubscribe") {
      return new Response("Not implemented", { status: 501 });
    }

    return new Response("Not found", { status: 404 });
  },
};
