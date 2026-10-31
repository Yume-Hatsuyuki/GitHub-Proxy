const ROUTES = Object.freeze({
  // Git smart HTTP, repository pages, Release pages and GitHub's normal web paths.
  gh: { host: "github.com", methods: ["GET", "HEAD", "POST"] },
  // Friendly aliases for common download types. These still use fixed upstreams.
  release: { host: "github.com", methods: ["GET", "HEAD"] },
  archive: { host: "github.com", methods: ["GET", "HEAD"] },
  raw: { host: "raw.githubusercontent.com", methods: ["GET", "HEAD"] },
  codeload: { host: "codeload.github.com", methods: ["GET", "HEAD"] },
  api: { host: "api.github.com", methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] },
  gist: { host: "gist.github.com", methods: ["GET", "HEAD", "POST"] },
  "gist-raw": { host: "gist.githubusercontent.com", methods: ["GET", "HEAD"] },
  avatars: { host: "avatars.githubusercontent.com", methods: ["GET", "HEAD"] },
  assets: { host: "github.githubassets.com", methods: ["GET", "HEAD"] }
});

// Redirects are followed only to these known GitHub-owned download/content hosts.
// This prevents the Worker from becoming an arbitrary URL/SSRF proxy.
const REDIRECT_HOSTS = new Set([
  "github.com",
  "raw.githubusercontent.com",
  "api.github.com",
  "codeload.github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
  "github.githubassets.com",
  "avatars.githubusercontent.com",
  "gist.github.com",
  "gist.githubusercontent.com",
  "github-cloud.s3.amazonaws.com",
  "github-production-release-asset-2e65be.s3.amazonaws.com",
  "github-production-user-asset-6210df.s3.amazonaws.com",
  "github-production-repository-file-5c1aeb.s3.amazonaws.com"
]);

const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "true-client-ip",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "x-proxy-key"
];

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 6;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return landingPage(url, url.pathname === "/health");
    }

    // Optional shared-secret protection. Set PROXY_KEY as a Worker secret to enable it.
    // Git clients can send it with http.extraHeader; see README.md.
    if (env.PROXY_KEY && request.headers.get("X-Proxy-Key") !== env.PROXY_KEY) {
      return new Response("Unauthorized", {
        status: 401,
        headers: { "Cache-Control": "no-store", "WWW-Authenticate": 'Bearer realm="GitHub Proxy"' }
      });
    }

    const firstSlash = url.pathname.indexOf("/", 1);
    const prefix = firstSlash === -1 ? url.pathname.slice(1) : url.pathname.slice(1, firstSlash);
    const route = ROUTES[prefix];

    if (!route) {
      return textResponse(
        "Not Found. See / for supported proxy endpoints.",
        404
      );
    }

    const upstreamPath = firstSlash === -1 ? "/" : url.pathname.slice(firstSlash);
    if (!upstreamPath.startsWith("/") || upstreamPath.startsWith("//") || upstreamPath.includes("\\")) {
      return textResponse("Invalid path", 400);
    }

    if (!route.methods.includes(request.method)) {
      return textResponse("Method Not Allowed", 405, {
        Allow: route.methods.join(", ")
      });
    }

    const upstreamUrl = new URL(`https://${route.host}${upstreamPath}${url.search}`);
    const isGitProtocol = /(?:^|\/)(?:info\/refs|git-upload-pack|git-receive-pack)(?:\/|$)/.test(upstreamPath);
    const noStore = prefix === "api" || isGitProtocol;
    return proxyToGitHub(request, upstreamUrl, noStore);
  }
};

async function proxyToGitHub(clientRequest, initialUrl, noStore) {
  let currentUrl = initialUrl;
  let method = clientRequest.method;
  let headers = makeUpstreamHeaders(clientRequest.headers);
  let body = method === "GET" || method === "HEAD" ? undefined : clientRequest.body;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const init = {
      method,
      headers,
      redirect: "manual",
      signal: clientRequest.signal,
      // Required by Node-based local tooling for streamed request bodies; Workers accepts it as well.
      duplex: "half"
    };
    if (body !== undefined && method !== "GET" && method !== "HEAD") {
      init.body = body;
    }
    if (noStore) init.cache = "no-store";

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(new Request(currentUrl.toString(), init));
    } catch (error) {
      return textResponse("Upstream request failed", 502);
    }

    if (!REDIRECT_STATUSES.has(upstreamResponse.status)) {
      return makeClientResponse(upstreamResponse, noStore);
    }

    const location = upstreamResponse.headers.get("Location");
    if (!location) return makeClientResponse(upstreamResponse, noStore);

    let nextUrl;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      return makeClientResponse(upstreamResponse, noStore);
    }

    // Never follow non-HTTPS or non-GitHub destinations.
    if (nextUrl.protocol !== "https:" || !REDIRECT_HOSTS.has(nextUrl.hostname)) {
      return makeClientResponse(upstreamResponse, noStore);
    }

    if (redirectCount === MAX_REDIRECTS) {
      return textResponse("Too many upstream redirects", 502);
    }

    // Match Fetch redirect semantics for POST on 301/302/303. This matters for
    // browser/API requests; Git's normal receive-pack POST is not normally redirected.
    if ((upstreamResponse.status === 301 || upstreamResponse.status === 302 || upstreamResponse.status === 303) && method !== "GET" && method !== "HEAD") {
      method = "GET";
      body = undefined;
      headers = new Headers(headers);
      headers.delete("content-type");
      headers.delete("content-encoding");
    } else if ((upstreamResponse.status === 307 || upstreamResponse.status === 308) && body !== undefined) {
      // A streaming body cannot safely be replayed after it has been sent.
      // Return the redirect rather than buffering a potentially huge Git pack.
      return makeClientResponse(upstreamResponse, noStore);
    }

    // Never forward credentials/cookies or the optional proxy key to a different host.
    if (nextUrl.hostname !== currentUrl.hostname) {
      headers = new Headers(headers);
      headers.delete("authorization");
      headers.delete("cookie");
      headers.delete("proxy-authorization");
      headers.delete("origin");
      headers.delete("referer");
      headers.delete("x-proxy-key");
    }

    currentUrl = nextUrl;
  }

  return textResponse("Upstream redirect handling failed", 502);
}

function makeUpstreamHeaders(sourceHeaders) {
  const headers = new Headers(sourceHeaders);
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
  // Explicitly avoid sending Cloudflare-specific routing metadata upstream.
  headers.delete("cf-worker");
  return headers;
}

function makeClientResponse(upstreamResponse, noStore) {
  const headers = new Headers(upstreamResponse.headers);
  for (const name of [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade"
  ]) {
    headers.delete(name);
  }

  // Do not cache Git protocol or API responses. For static downloads,
  // preserve GitHub's own cache headers and allow normal CDN cache behavior.
  if (noStore) headers.set("Cache-Control", "no-store");

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers
  });
}

function textResponse(message, status = 200, extraHeaders = {}) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

function landingPage(url, healthOnly = false) {
  if (healthOnly) {
    return new Response("ok", {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  }

  const base = `${url.protocol}//${url.host}`;
  const escapedBase = escapeHtml(base);
  const gitUrl = `${base}/gh/OWNER/REPOSITORY.git`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GitHub Proxy</title>
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#101319;color:#e8edf5}
body{max-width:900px;margin:48px auto;padding:0 22px;line-height:1.65}
h1{font-size:28px;margin-bottom:4px}.muted{color:#8793a4;font-size:14px}
.card{background:#191f29;border:1px solid #303b4b;border-radius:12px;padding:18px 20px;margin:16px 0}
p,li{color:#b6c0cf}code{background:#252e3b;border-radius:5px;padding:3px 6px;overflow-wrap:anywhere;color:#d7e7ff}
pre{background:#0b0e13;border:1px solid #303b4b;border-radius:8px;padding:13px;overflow:auto;color:#d7e7ff}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:8px;border-bottom:1px solid #303b4b}th{color:#e8edf5}
</style>
</head>
<body>
<h1>GitHub Proxy</h1>
<p class="muted">Fixed-upstream HTTPS proxy · SSH is not supported</p>
<div class="card">
<strong>Git over HTTPS</strong>
<p>Replace the <code>https://github.com/</code> prefix in a repository URL with <code>${escapedBase}/gh/</code>.</p>
<pre>git remote set-url origin ${escapeHtml(gitUrl)}
git push -u origin main</pre>
</div>
<div class="card">
<strong>Supported endpoints</strong>
<table>
<tr><th>Path</th><th>Upstream</th><th>Use</th></tr>
<tr><td><code>/gh/*</code></td><td>github.com</td><td>Git HTTPS, repository pages and GitHub paths</td></tr>
<tr><td><code>/raw/*</code></td><td>raw.githubusercontent.com</td><td>Raw files</td></tr>
<tr><td><code>/release/*</code></td><td>github.com</td><td>Release assets</td></tr>
<tr><td><code>/archive/*</code></td><td>github.com</td><td>Source ZIP/TAR.GZ</td></tr>
<tr><td><code>/codeload/*</code></td><td>codeload.github.com</td><td>Source archives</td></tr>
<tr><td><code>/api/*</code></td><td>api.github.com</td><td>REST API and GraphQL</td></tr>
<tr><td><code>/gist/*</code></td><td>gist.github.com</td><td>Gist pages</td></tr>
<tr><td><code>/gist-raw/*</code></td><td>gist.githubusercontent.com</td><td>Gist raw files</td></tr>
<tr><td><code>/avatars/*</code></td><td>avatars.githubusercontent.com</td><td>Avatar images</td></tr>
<tr><td><code>/assets/*</code></td><td>github.githubassets.com</td><td>GitHub static assets</td></tr>
</table>
</div>
<div class="card">
<strong>Examples</strong>
<p>Raw file:</p><pre>${escapedBase}/raw/OWNER/REPOSITORY/BRANCH/PATH/TO/FILE</pre>
<p>Release asset:</p><pre>${escapedBase}/release/OWNER/REPOSITORY/releases/download/TAG/FILE</pre>
<p>Source archive:</p><pre>${escapedBase}/archive/OWNER/REPOSITORY/archive/refs/heads/BRANCH.zip</pre>
<p>API:</p><pre>${escapedBase}/api/repos/OWNER/REPOSITORY</pre>
</div>
<p class="muted">Requests are forwarded only to fixed GitHub-related upstream hosts; arbitrary destination URLs are not accepted. Git protocol and API requests are not cached. GitHub web-page HTML is not fully rewritten, so this is not a complete website mirror. Public deployments can be used by anyone unless an access key is configured.</p>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    }
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}