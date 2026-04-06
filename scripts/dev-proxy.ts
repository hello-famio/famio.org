/**
 * Local dev proxy for index.html → staging Worker.
 *
 * Serves index.html at http://localhost:3000 and forwards all non-root
 * requests (/signup, /manage, /confirm, /unsubscribe) to the staging Worker.
 *
 * To see Worker logs (stub email/purelymail output), run in a separate terminal:
 *   bun run logs:staging
 *
 * Usage: bun run dev:frontend
 */

const STAGING = "https://famio-worker-staging.bevn.workers.dev";
const PORT = 3000;

const API_PATHS = ["/signup", "/manage", "/confirm", "/unsubscribe"];

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    const isApi = API_PATHS.some(
      (p) => url.pathname === p || url.pathname.startsWith(p + "/")
    );

    if (isApi) {
      const upstream = new URL(url.pathname + url.search, STAGING);

      // Only forward headers the Worker needs — strip browser-specific headers
      // (Sec-Fetch-*, Upgrade-Insecure-Requests, etc.) that confuse Cloudflare.
      const headers = new Headers();
      headers.set("Host", upstream.hostname);
      const forward = ["content-type", "content-length", "authorization", "accept"];
      for (const name of forward) {
        const val = req.headers.get(name);
        if (val) headers.set(name, val);
      }

      // GET/HEAD must not have a body
      const body = req.method === "GET" || req.method === "HEAD" ? null : req.body;

      // @ts-ignore — Bun-specific tls option, safe for local dev proxy
      return fetch(upstream.toString(), { method: req.method, headers, body, tls: { rejectUnauthorized: false } });
    }

    // Serve index.html for everything else
    const file = Bun.file("index.html");
    return new Response(file, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
});

console.log(`Dev proxy running at http://localhost:${PORT}`);
console.log(`API requests → ${STAGING}`);
console.log(`Worker logs  → run "bun run logs:staging" in a separate terminal`);
