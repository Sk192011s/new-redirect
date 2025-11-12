// main.ts — Deno Deploy video proxy (KV link-based, no token)
import { openKv } from "https://deno.land/x/kv/mod.ts";

const kv = await openKv();

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // 1️⃣ Frontend HTML
  if (url.pathname === "/") {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Deno Video Proxy (KV-based)</title>
<style>
html,body{height:100%;margin:0;overflow:hidden;font-family:sans-serif;background:#f0f2f5;}
body{display:flex;justify-content:center;align-items:center;}
.container{text-align:center;background:white;padding:30px 40px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);max-width:500px;width:90%;}
input[type=text]{width:80%;padding:8px 12px;border-radius:6px;border:1px solid #ccc;margin-bottom:12px;}
button{padding:8px 14px;margin:5px;border-radius:6px;border:none;background:#4CAF50;color:white;cursor:pointer;font-weight:bold;}
button:hover{background:#45a049;}
a{color:#2196F3;text-decoration:none;font-weight:bold;}
</style>
</head>
<body>
<div class="container">
<h2>Deno Video Proxy Generator (KV-based)</h2>
<input type="text" id="videoSrc" placeholder="Enter video URL"><br>
<button id="generateBtn">Generate Proxy Link</button>

<div style="margin-top:15px;">
Proxy Link:<br>
<input type="text" id="resultLink" readonly>
<button id="copyBtn">Copy</button>
</div>
</div>

<script>
async function generateLink(src){
  const res = await fetch('/generateLink?src='+encodeURIComponent(src));
  const link = await res.text();
  return link;
}

document.getElementById("generateBtn").onclick=async ()=>{
  const src=document.getElementById("videoSrc").value.trim();
  if(!src.startsWith("https://")){alert("Enter valid HTTPS URL");return;}
  const proxyLink = await generateLink(src);
  document.getElementById("resultLink").value=proxyLink;
};

document.getElementById("copyBtn").onclick=()=>{
  const link=document.getElementById("resultLink");
  link.select();
  navigator.clipboard.writeText(link.value);
  alert("Copied proxy link!");
};
</script>
</body>
</html>
    `;
    return new Response(html,{headers:{"content-type":"text/html; charset=utf-8"}});
  }

  // 2️⃣ Generate KV-based link
  if(url.pathname==="/generateLink"){
    const src = url.searchParams.get("src");
    if(!src || !src.startsWith("https://")) return new Response("Invalid src",{status:400});
    // KV entry: src -> src
    await kv.set(["videoLink", src], src);
    const proxyLink = `${req.headers.get("origin") || ""}/video?src=${encodeURIComponent(src)}`;
    return new Response(proxyLink, { headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  // 3️⃣ Video proxy
  if(url.pathname==="/video"){
    const src = url.searchParams.get("src");
    if(!src) return new Response("Missing src", {status:400});

    // Check KV
    const kvEntry = await kv.get(["videoLink", src]);
    if(!kvEntry.value) return new Response("Forbidden: src not registered", {status:403});

    // Forward request to upstream
    const range = req.headers.get("range") || "";
    const headers: Record<string,string> = {};
    if(range) headers["range"] = range;

    const upstream = await fetch(src, { headers });
    const respHeaders = new Headers();
    respHeaders.set("Content-Type", upstream.headers.get("content-type") || "video/mp4");
    if(upstream.headers.get("content-length")) respHeaders.set("Content-Length", upstream.headers.get("content-length")!);
    if(upstream.headers.get("content-range")) respHeaders.set("Content-Range", upstream.headers.get("content-range")!);
    respHeaders.set("Cache-Control","no-store");
    respHeaders.set("Access-Control-Allow-Origin","*");
    respHeaders.set("Access-Control-Allow-Methods","GET, OPTIONS");
    respHeaders.set("Access-Control-Allow-Headers","Range");

    return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
  }

  return new Response("Not found",{status:404});
}
