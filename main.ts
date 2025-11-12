// main.ts — Deno Deploy secure token-based video proxy + KV short link + frontend
import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

const kv = await Deno.openKv();

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // 1️⃣ Frontend
  if (url.pathname === "/") {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Deno Secure Video Proxy</title>
<style>
html, body { height:100%; margin:0; overflow:hidden; font-family:sans-serif; background:#f0f2f5; }
body { display:flex; justify-content:center; align-items:center; }
.container { text-align:center; background:white; padding:30px 40px; border-radius:12px; box-shadow:0 4px 20px rgba(0,0,0,0.1); max-width:500px; width:90%; }
input[type=text] { width:80%; padding:8px 12px; border-radius:6px; border:1px solid #ccc; margin-bottom:12px; }
button { padding:8px 14px; margin:5px; border-radius:6px; border:none; background:#4CAF50; color:white; cursor:pointer; font-weight:bold; }
button:hover { background:#45a049; }
a { color:#2196F3; text-decoration:none; font-weight:bold; }
</style>
</head>
<body>
<div class="container">
<h2>Deno Secure Video Proxy</h2>
<input type="text" id="videoSrc" placeholder="Enter video HTTPS URL"><br>
<button id="generateBtn">Generate Proxy Link</button>
<button id="shortDirectBtn">Generate Short Link Only</button>

<div style="margin-top:15px;">
  <div>
    Proxy Link:<br>
    <input type="text" id="resultLink" readonly>
    <button id="copyBtn">Copy</button>
  </div>
  <div style="margin-top:10px;">
    Short Link:<br>
    <span id="shortLinkContainer"></span>
    <button id="shortBtn">Shorten</button>
    <button id="copyShortBtn">Copy Short</button>
  </div>
</div>
</div>

<script>
function showShortLink(shortUrl) {
  document.getElementById("shortLinkContainer").innerHTML = \`<a href="\${shortUrl}" target="_blank">\${shortUrl}</a>\`;
}

async function generateShortLink(url) {
  try {
    const res = await fetch('/short?url=' + encodeURIComponent(url));
    const shortUrl = await res.text();
    showShortLink(shortUrl);
  } catch(e){ alert("Shortening failed"); }
}

document.getElementById("generateBtn").onclick = async () => {
  const src = document.getElementById("videoSrc").value.trim();
  if (!src.startsWith("https://")) { alert("Enter a valid HTTPS URL"); return; }
  const res = await fetch('/generate?src=' + encodeURIComponent(src));
  const token = await res.text();
  const proxyLink = \`\${window.location.origin}/video?token=\${token}\`;
  document.getElementById("resultLink").value = proxyLink;
  document.getElementById("shortLinkContainer").innerHTML = "";
};

document.getElementById("copyBtn").onclick = () => {
  const link = document.getElementById("resultLink");
  link.select();
  navigator.clipboard.writeText(link.value);
  alert("Copied proxy link!");
};

document.getElementById("shortBtn").onclick = () => {
  const proxyLink = document.getElementById("resultLink").value;
  if (!proxyLink) { alert("Generate proxy link first!"); return; }
  generateShortLink(proxyLink);
};

document.getElementById("shortDirectBtn").onclick = async () => {
  const src = document.getElementById("videoSrc").value.trim();
  if (!src.startsWith("https://")) { alert("Enter a valid HTTPS URL"); return; }
  const res = await fetch('/generate?src=' + encodeURIComponent(src));
  const token = await res.text();
  const proxyLink = \`\${window.location.origin}/video?token=\${token}\`;
  generateShortLink(proxyLink);
};

document.getElementById("copyShortBtn").onclick = () => {
  const shortLinkEl = document.querySelector("#shortLinkContainer a");
  if (!shortLinkEl) { alert("Generate short link first!"); return; }
  navigator.clipboard.writeText(shortLinkEl.href);
  alert("Copied short link!");
};
</script>
</body>
</html>
    `;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  // 2️⃣ Generate proxy token (permanent)
  if (url.pathname === "/generate") {
    const src = url.searchParams.get("src");
    if (!src) return new Response("Missing src", { status: 400 });
    if (!src.startsWith("https://")) return new Response("Invalid src", { status: 400 });

    const token = crypto.randomUUID();
    await kv.set(["video", token], src); // permanent, no TTL
    return new Response(token, { headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  // 3️⃣ Video proxy (token protected)
  if (url.pathname === "/video") {
    const token = url.searchParams.get("token");
    if (!token) return new Response("Missing token", { status: 400 });

    const kvEntry = await kv.get(["video", token]);
    if (!kvEntry.value) return new Response("Invalid token", { status: 403 });

    const src = kvEntry.value;
    const range = req.headers.get("range") || "";
    const headers: Record<string,string> = {};
    if (range) headers["range"] = range;

    const upstream = await fetch(src, { headers });
    const respHeaders = new Headers();
    respHeaders.set("Content-Type", upstream.headers.get("content-type") || "video/mp4");
    upstream.headers.get("content-length") && respHeaders.set("Content-Length", upstream.headers.get("content-length")!);
    upstream.headers.get("content-range") && respHeaders.set("Content-Range", upstream.headers.get("content-range")!);
    respHeaders.set("Cache-Control", "no-store");
    respHeaders.set("Access-Control-Allow-Origin", "*");
    respHeaders.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    respHeaders.set("Access-Control-Allow-Headers", "Range");
    respHeaders.set("Accept-Ranges", "bytes");

    return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
  }

  // 4️⃣ Short link generation (permanent)
  if (url.pathname === "/short") {
    const fullUrl = url.searchParams.get("url");
    if (!fullUrl) return new Response("Missing url", { status: 400 });

    let hash: string;
    do {
      hash = crypto.randomUUID().slice(0,8);
    } while ((await kv.get(["short", hash])).value);

    await kv.set(["short", hash], fullUrl); // permanent
    const shortUrl = `${req.headers.get("host") ? "https://" + req.headers.get("host") : ""}/s/${hash}`;
    return new Response(shortUrl, { headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  // 5️⃣ Short link redirect
  if (url.pathname.startsWith("/s/")) {
    const hash = url.pathname.split("/")[2];
    if (!hash) return new Response("Invalid short link", { status: 400 });

    const kvEntry = await kv.get(["short", hash]);
    if (!kvEntry.value) return new Response("Short link not found", { status: 404 });

    return Response.redirect(kvEntry.value, 302);
  }

  return new Response("Not found", { status: 404 });
}
