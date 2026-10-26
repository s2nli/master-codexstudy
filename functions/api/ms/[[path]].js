// Cloudflare Pages Function: /api/ms/<endpoint>  ->  <UPSTREAM>/<endpoint>
// (Vercel keeps using /api/ms.js; Cloudflare Pages uses this file automatically.)
// Optional env var in Cloudflare: MS_UPSTREAM (defaults to the Master Sahab API below).
const DEFAULT_UPSTREAM = "https://mastersahab.studybeepro.site/api/ms";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Cache-Control": "no-store"
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

export async function onRequest({ request, env, params }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const upstreamBase = String((env && env.MS_UPSTREAM) || DEFAULT_UPSTREAM).replace(/\/+$/, "");
  const origin = new URL(upstreamBase).origin;

  let p = params && params.path;
  if (Array.isArray(p)) p = p.join("/");
  p = String(p || "").replace(/^\/+/, "");

  // Health check: open https://<your-site>/api/ms/ping
  if (p === "ping") return json({ ok: true, proxy: "cloudflare-pages", upstream: upstreamBase });
  if (!/^[a-zA-Z0-9_\/-]+$/.test(p)) return json({ error: "Bad path", path: p }, 400);

  const method = request.method === "POST" ? "POST" : "GET";
  const headers = {
    Accept: "application/json",
    Origin: origin,
    Referer: origin + "/",
    "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36"
  };
  const init = { method, headers };
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    init.body = await request.text();
  }

  const url = upstreamBase + "/" + p;
  try {
    const upstream = await fetch(url, init);
    const text = await upstream.text();
    const type = upstream.headers.get("content-type") || "";
    if (!upstream.ok || !/json/i.test(type)) {
      return json({
        error: "Upstream " + upstream.status + (/json/i.test(type) ? "" : " (not JSON)"),
        upstreamStatus: upstream.status,
        upstreamUrl: url,
        snippet: text.slice(0, 200)
      }, 502);
    }
    return new Response(text, { status: 200, headers: { ...CORS, "Content-Type": type } });
  } catch (error) {
    return json({ error: "Upstream unreachable", detail: String((error && error.message) || error) }, 502);
  }
}
