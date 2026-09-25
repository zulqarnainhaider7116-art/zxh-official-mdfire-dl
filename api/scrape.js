// api/scrape.js — ZXH OFFICIAL MediaFire Scraper
// 🔐 Ultra-secure: only works from ZXH OFFICIAL website

/* =========================================================
   SECURITY CONFIG
   ========================================================= */

const ALLOWED_ORIGINS = new Set([
  "https://zxh-official-mdfire-dl.vercel.app"
  // Custom domain ho to yahan add karein:
  // "https://yourcustomdomain.com"
]);

/* 🔑 Secret client token — frontend bhejta hai, koi aur nahi jaanta */
const CLIENT_HEADER = "x-zxh-client";
const CLIENT_TOKEN  = "zxh-mdfire-web-2024-secure-v1";

/* Rate limit */
const RATE_LIMIT      = new Map();
const RATE_WINDOW_MS  = 60 * 1000; // 1 minute
const RATE_MAX        = 20;        // 20 req/min/IP

/* =========================================================
   HELPERS
   ========================================================= */

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown";
}

function isRateLimited(req) {
  const ip  = getClientIp(req);
  const now = Date.now();
  const e   = RATE_LIMIT.get(ip);

  if (!e || now - e.start > RATE_WINDOW_MS) {
    RATE_LIMIT.set(ip, { start: now, count: 1 });
    return false;
  }
  e.count += 1;
  return e.count > RATE_MAX;
}

/*
  🛡️ STRICT REQUEST GUARD
  ------------------------------------------------------
  Allowed ONLY when:
    1. Custom header "x-zxh-client" matches secret token
    2. AND (Origin OR Referer) matches allowed origin

  Address bar navigation → no custom header → BLOCKED ✅
  Other website fetch    → wrong Origin → BLOCKED ✅
  Your own website fetch → same-origin + header → ALLOWED ✅
  ------------------------------------------------------
*/
function checkRequest(req) {
  const origin  = String(req.headers.origin  || "").trim();
  const referer = String(req.headers.referer || "").trim();
  const client  = String(req.headers[CLIENT_HEADER] || "").trim();

  // 1) Custom secret header check
  if (client !== CLIENT_TOKEN) {
    return { ok: false, reason: "invalid_client" };
  }

  // 2) Origin / Referer check
  const sourceUrl = origin || referer;
  if (!sourceUrl) {
    return { ok: false, reason: "no_source" };
  }

  try {
    const u = new URL(sourceUrl);
    if (!ALLOWED_ORIGINS.has(u.origin)) {
      return { ok: false, reason: "bad_origin" };
    }
    return { ok: true, cors: u.origin };
  } catch {
    return { ok: false, reason: "bad_source" };
  }
}

/* =========================================================
   MAIN HANDLER
   ========================================================= */
export default async function handler(req, res) {

  /* Security headers */
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");

  /* Method check */
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  /* 🔐 Strict request guard */
  const guard = checkRequest(req);

  if (!guard.ok) {
    if (guard.reason !== "no_source") {
      res.setHeader("Access-Control-Allow-Origin", "null");
      res.setHeader("Vary", "Origin");
    }
    return res.status(403).json({
      success: false,
      error: "ZXH OFFICIAL API is private and protected."
    });
  }

  /* Set CORS for allowed origin */
  if (guard.cors) {
    res.setHeader("Access-Control-Allow-Origin", guard.cors);
    res.setHeader("Vary", "Origin");
  }

  /* Rate limit */
  if (isRateLimited(req)) {
    return res.status(429).json({
      success: false,
      error: "Too many requests. Please slow down."
    });
  }

  try {
    const rawUrl = req.query?.url;

    if (!rawUrl) {
      return res.status(400).json({
        success: false,
        error: "MediaFire URL is required."
      });
    }

    if (String(rawUrl).length > 2048) {
      return res.status(400).json({
        success: false,
        error: "URL is too long."
      });
    }

    let mediafireUrl;
    try {
      mediafireUrl = new URL(String(rawUrl).trim());
    } catch {
      return res.status(400).json({
        success: false,
        error: "Invalid URL."
      });
    }

    if (mediafireUrl.protocol !== "https:") {
      return res.status(400).json({
        success: false,
        error: "Only HTTPS MediaFire URLs are supported."
      });
    }

    const host = mediafireUrl.hostname.toLowerCase();
    if (host !== "mediafire.com" && !host.endsWith(".mediafire.com")) {
      return res.status(400).json({
        success: false,
        error: "Only MediaFire URLs are supported."
      });
    }

    /* Fetch with timeout */
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    let response;
    try {
      response = await fetch(mediafireUrl.toString(), {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
            "AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/131.0.0.0 Safari/537.36",
          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache"
        }
      });
    } catch (e) {
      clearTimeout(timeout);
      return res.status(504).json({
        success: false,
        error: e?.name === "AbortError"
          ? "MediaFire took too long to respond."
          : "Could not reach MediaFire."
      });
    }
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        error: `MediaFire returned HTTP ${response.status}.`
      });
    }

    const html = await response.text();
    if (!html || html.length < 100) {
      return res.status(502).json({
        success: false,
        error: "MediaFire returned an empty or invalid page."
      });
    }

    /* Strip scripts / styles / comments */
    const cleanHtml = html
      .replace(/<!--[\s\S]*?-->/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/\s+/g, " ");

    /* ---------- DOWNLOAD URL ---------- */
    let downloadUrl = "";
    const downloadPatterns = [
      /href=["']([^"']+)["'][^>]*id=["']downloadButton["']/i,
      /id=["']downloadButton["'][^>]*href=["']([^"']+)["']/i,
      /href=["']([^"']+)["'][^>]*class=["'][^"']*download[^"']*/i,
      /class=["'][^"']*download[^"']*["'][^>]*href=["']([^"']+)["']/i,
      /"(https?:\/\/[^"]*mediafire[^"]*\/download[^"]*)"/i,
      /(https?:\/\/download[^"' <]+)/i
    ];
    for (const pattern of downloadPatterns) {
      const match = cleanHtml.match(pattern);
      if (match && match[1]) {
        downloadUrl = decodeHtml(match[1]);
        break;
      }
    }
    if (!downloadUrl) {
      const allLinks = [...cleanHtml.matchAll(/href\s*=\s*["']([^"']+)["']/gi)];
      for (const match of allLinks) {
        const href = decodeHtml(match[1]);
        if (/download/i.test(href) && /^https?:\/\//i.test(href)) {
          downloadUrl = href;
          break;
        }
      }
    }

    /* ---------- FILE NAME ---------- */
    let filename = "";
    const filenamePatterns = [
      /property=["']og:title["'][^>]*content=["']([^"']+)["']/i,
      /content=["']([^"']+)["'][^>]*property=["']og:title["']/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i,
      /class=["'][^"']*filename[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i
    ];
    for (const pattern of filenamePatterns) {
      const match = cleanHtml.match(pattern);
      if (match && match[1]) {
        filename = cleanText(decodeHtml(match[1]));
        break;
      }
    }
    filename = filename.replace(/\s*[-|]\s*MediaFire.*$/i, "").trim();

    /* ---------- FILE SIZE ---------- */
    let filesize = "";
    const sizePatterns = [
      /(?:File\s*Size|Size)\s*[:\-]?\s*<\/?[^>]*>\s*([^<]{1,50})/i,
      /(?:File\s*Size|Size)\s*[:\-]\s*([^<\n]{1,50})/i,
      /class=["'][^"']*(?:file-size|filesize)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
      /\b(\d+(?:\.\d+)?\s*(?:KB|MB|GB|TB|B))\b/i
    ];
    for (const pattern of sizePatterns) {
      const match = cleanHtml.match(pattern);
      if (match && match[1]) {
        filesize = cleanText(decodeHtml(match[1]));
        break;
      }
    }

    /* ---------- UPLOAD DATE ---------- */
    let uploadDate = "";
    const datePatterns = [
      /(?:Uploaded|Upload\s*Date|Uploaded\s*On)\s*[:\-]?\s*([^<\n]{3,100})/i,
      /class=["'][^"']*(?:upload-date|uploaded|date-uploaded)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
      /(?:data-upload-date|data-uploaded)=["']([^"']{3,100})["']/i
    ];
    for (const pattern of datePatterns) {
      const match = cleanHtml.match(pattern);
      if (!match || !match[1]) continue;
      const candidate = cleanText(decodeHtml(match[1]));
      const looksLikeCode =
        candidate.includes("{") || candidate.includes("}") ||
        candidate.includes("color:") || candidate.includes("font-") ||
        candidate.includes("@media") || candidate.includes("display:") ||
        candidate.includes("position:") ||
        candidate.includes("<") || candidate.includes(">");
      if (looksLikeCode) continue;
      if (candidate.length > 100) continue;
      const looksLikeDate =
        /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/i.test(candidate) ||
        /\b\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4}\b/.test(candidate) ||
        /\b\d{1,2}\s+(?:days?|weeks?|months?|years?)\s+ago\b/i.test(candidate) ||
        /\b\d{4}\b/.test(candidate);
      if (!looksLikeDate) continue;
      uploadDate = candidate;
      break;
    }

    /* Filename fallback */
    if (!filename) {
      const pathParts = mediafireUrl.pathname.split("/").filter(Boolean);
      if (pathParts.length) {
        try {
          filename = decodeURIComponent(pathParts[pathParts.length - 1]);
        } catch {
          filename = pathParts[pathParts.length - 1];
        }
      }
    }

    return res.status(200).json({
      success: true,
      filename: filename || "Unknown file",
      filesize: filesize || "Size unknown",
      upload_date: uploadDate || "",
      original_url: mediafireUrl.toString(),
      proxied_download_url: downloadUrl || ""
    });

  } catch (error) {
    console.error("ZXH MediaFire API Error:", error);
    return res.status(500).json({
      success: false,
      error: "Could not process the MediaFire link."
    });
  }
}

/* =========================================================
   HELPERS
   ========================================================= */
function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/")
    .replace(/&#x3D;/gi, "=");
}

function cleanText(value) {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  }
