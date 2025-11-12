// main.ts — Deno Deploy video proxy + short link using KV + frontend

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

const kv = await Deno.openKv(); // Deno KV instance

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // Root page — frontend HTML
  if (url.pathname === "/") {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Deno Video Proxy Generator</title>
</head>
<body>
<h2>Deno Video Proxy Link Generator</h2>
<input type="text" id="videoSrc" placeholder="Enter video URL" style="width: 80%;">
<button id="generateBtn">Generate Proxy Link</button>
<br><br>
<input type="text" id="resultLink" style="width: 80%;" readonly>
<button id="copyBtn">Copy Link</button>
<button id="shortBtn">Shorten Link</button>

<script>
const baseProxy = window.location.origin + "/video?src=";

document.getElementById("generateBtn").onclick = () => {
  const src = document.getElementById("videoSrc").value.trim();
  if (!src.startsWith("https://")) {
    alert("Please enter a valid HTTPS URL");
    return;
  }
  const proxyLink = baseProxy + encodeURIComponent(src);
  document.getElementById("resultLink").value = proxyLink;
};

document.getElementById("copyBtn").onclick = () => {
  const link = document.getElementById("resultLink");
  link.select();
  link.setSelectionRange(0, 99999);
  navigator.clipboard.writeText(link.value);
  alert("Copied to clipboard!");
};

document.getElementById("shortBtn").onclick = async () => {
  const link = document.getElementById("resultLink").value;
  if (!link) return alert("Generate a link first!");
  try {
    const res = await fetch('/short?url=' + encodeURIComponent(link));
    const shortUrl = await res.text();
    document.getElementById("resultLink").value = shortUrl;
  } catch(e) {
    alert("Shortening failed");
  }
};
</script>
</body>
</html>
    `;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  // Video proxy
  if (url.pathname === "/video") {
    const src = url.searchParams.get("src");
    if (!src) return new Response("Missing src", { status: 400 });
    if (!src.startsWith("https://")) return new Response("Invalid src", { status: 400 });

    const range = req.headers.get("range") || "";
    const headers: Record<string, string> = {};
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

    return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
  }

  // Shorten link (store in KV)
  if (url.pathname === "/short") {
    const fullUrl = url.searchParams.get("url");
    if (!fullUrl) return new Response("Missing url parameter", { status: 400 });

    // Simple hash
    const hash = crypto.randomUUID().slice(0,8);
    await kv.set(["short", hash], fullUrl);

    const shortUrl = `${req.headers.get("origin") || ""}/s/${hash}`;
    return new Response(shortUrl, { headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  // Redirect short link
  if (url.pathname.startsWith("/s/")) {
    const hash = url.pathname.split("/")[2];
    if (!hash) return new Response("Invalid short link", { status: 400 });

    const kvEntry = await kv.get(["short", hash]);
    if (!kvEntry.value) return new Response("Short link not found", { status: 404 });

    return Response.redirect(kvEntry.value, 302);
  }

  return new Response("Not found", { status: 404 });
}
