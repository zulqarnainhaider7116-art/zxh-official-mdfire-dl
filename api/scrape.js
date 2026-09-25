export default async function handler(req, res) {
  const OFFICIAL_ORIGIN = "https://zxh-official-mdfire-dl.vercel.app";
  const CLIENT_TOKEN = "ZXH-MDFIRE-OFFICIAL-2026";

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  // --------------------------------------------------
  // CORS — official frontend only
  // --------------------------------------------------

  const origin = String(req.headers.origin || "");
  const referer = String(req.headers.referer || "");

  const validOrigin =
    origin === OFFICIAL_ORIGIN;

  const validReferer =
    referer === OFFICIAL_ORIGIN + "/" ||
    referer.startsWith(OFFICIAL_ORIGIN + "/");

  // Direct browser/API access is not allowed.
  if (!validOrigin || !validReferer) {
    return res.status(403).json({
      success: false,
      error: "ZXH OFFICIAL API is private."
    });
  }

  // --------------------------------------------------
  // Private client header
  // --------------------------------------------------

  const clientToken =
    String(req.headers["x-zxh-client"] || "");

  if (clientToken !== CLIENT_TOKEN) {
    return res.status(403).json({
      success: false,
      error: "Unauthorized ZXH client."
    });
  }

  // --------------------------------------------------
  // Method
  // --------------------------------------------------

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  // --------------------------------------------------
  // URL
  // --------------------------------------------------

  const rawUrl = req.query?.url;

  if (!rawUrl) {
    return res.status(400).json({
      success: false,
      error: "MediaFire URL is required."
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

  if (
    host !== "mediafire.com" &&
    !host.endsWith(".mediafire.com")
  ) {
    return res.status(400).json({
      success: false,
      error: "Only MediaFire URLs are supported."
    });
  }

  // --------------------------------------------------
  // Fetch MediaFire public page
  // --------------------------------------------------

  try {
    const response = await fetch(mediafireUrl.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",

        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

        "Accept-Language":
          "en-US,en;q=0.9",

        "Cache-Control":
          "no-cache"
      }
    });

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        error:
          `MediaFire returned HTTP ${response.status}.`
      });
    }

    const html = await response.text();

    if (!html || html.length < 100) {
      return res.status(502).json({
        success: false,
        error:
          "MediaFire returned an empty or invalid page."
      });
    }

    // ==================================================
    // CLEAN HTML
    // ==================================================

    const cleanHtml = html
      .replace(
        /<script[\s\S]*?<\/script>/gi,
        ""
      )
      .replace(
        /<style[\s\S]*?<\/style>/gi,
        ""
      )
      .replace(
        /<!--[\s\S]*?-->/g,
        ""
      );

    // ==================================================
    // DOWNLOAD URL
    // ==================================================

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
        downloadUrl =
          decodeHtml(match[1]).trim();

        break;
      }
    }

    // Backup link scan
    if (!downloadUrl) {

      const allLinks = [
        ...cleanHtml.matchAll(
          /href\s*=\s*["']([^"']+)["']/gi
        )
      ];

      for (const match of allLinks) {

        const href =
          decodeHtml(match[1]).trim();

        if (
          /download/i.test(href) &&
          /^https?:\/\//i.test(href)
        ) {
          downloadUrl = href;
          break;
        }
      }
    }

    // ==================================================
    // FILE NAME
    // ==================================================

    let filename = "";

    const filenamePatterns = [

      /property=["']og:title["'][^>]*content=["']([^"']+)["']/i,

      /content=["']([^"']+)["'][^>]*property=["']og:title["']/i,

      /<title[^>]*>([\s\S]*?)<\/title>/i,

      /class=["'][^"']*filename[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i
    ];

    for (const pattern of filenamePatterns) {

      const match =
        cleanHtml.match(pattern);

      if (match && match[1]) {

        filename =
          cleanText(
            decodeHtml(match[1])
          );

        break;
      }
    }

    filename = filename
      .replace(
        /\s*[-|]\s*MediaFire.*$/i,
        ""
      )
      .trim();

    // ==================================================
    // FILE SIZE
    // ==================================================

    let filesize = "";

    const sizePatterns = [

      /(?:File\s*Size|Size)\s*[:\-]?\s*<\/?[^>]*>\s*([^<]{1,50})/i,

      /(?:File\s*Size|Size)\s*[:\-]\s*([^<\n]{1,50})/i,

      /class=["'][^"']*(?:file-size|filesize)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,

      /\b(\d+(?:\.\d+)?\s*(?:KB|MB|GB|TB|B))\b/i
    ];

    for (const pattern of sizePatterns) {

      const match =
        cleanHtml.match(pattern);

      if (match && match[1]) {

        const value =
          cleanText(
            decodeHtml(match[1])
          );

        if (
          value &&
          !value.includes("{") &&
          !value.includes("}") &&
          !value.includes("color:")
        ) {
          filesize = value;
          break;
        }
      }
    }

    // ==================================================
    // UPLOAD DATE — FIXED
    // ==================================================

    let uploadDate = "";

    /*
     * IMPORTANT:
     *
     * Do NOT search for generic "Date".
     * MediaFire CSS contains words that can accidentally
     * match Date/Upload patterns.
     */

    const datePatterns = [

      /(?:Uploaded|Upload Date|Uploaded On)\s*[:\-]?\s*([^<\n]{3,100})/i,

      /class=["'][^"']*(?:upload-date|uploaded)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i
    ];

    for (const pattern of datePatterns) {

      const match =
        cleanHtml.match(pattern);

      if (!match || !match[1]) {
        continue;
      }

      const value =
        cleanText(
          decodeHtml(match[1])
        );

      // Reject CSS / malformed values
      if (
        !value ||
        value.includes("{") ||
        value.includes("}") ||
        value.includes("color:") ||
        value.includes("font-") ||
        value.includes("@media") ||
        value.length > 100
      ) {
        continue;
      }

      // Basic date sanity check
      const looksLikeDate =
        /\b\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}\b/.test(value) ||
        /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/i.test(value) ||
        /\b\d{4}\b/.test(value);

      if (looksLikeDate) {
        uploadDate = value;
        break;
      }
    }

    // ==================================================
    // FALLBACK FILE NAME
    // ==================================================

    if (!filename) {

      const pathParts =
        mediafireUrl.pathname
          .split("/")
          .filter(Boolean);

      if (pathParts.length) {

        try {
          filename =
            decodeURIComponent(
              pathParts[pathParts.length - 1]
            );
        } catch {
          filename =
            pathParts[pathParts.length - 1];
        }
      }
    }

    // ==================================================
    // FINAL RESPONSE
    // ==================================================

    return res.status(200).json({

      success: true,

      filename:
        filename || "Unknown file",

      filesize:
        filesize || "Size unknown",

      upload_date:
        uploadDate || "",

      original_url:
        mediafireUrl.toString(),

      proxied_download_url:
        downloadUrl || ""
    });

  } catch (error) {

    console.error(
      "ZXH MediaFire API Error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Could not process the MediaFire link."
    });
  }
}


// ======================================================
// HELPERS
// ======================================================

function decodeHtml(value) {

  return String(value)

    .replace(/&amp;/gi, "&")

    .replace(/&quot;/gi, '"')

    .replace(/&#39;/gi, "'")

    .replace(/&#x27;/gi, "'")

    .replace(/&lt;/gi, "<")

    .replace(/&gt;/gi, ">")

    .replace(/&#x2F;/gi, "/");
}


function cleanText(value) {

  return String(value)

    .replace(
      /<script[\s\S]*?<\/script>/gi,
      ""
    )

    .replace(
      /<style[\s\S]*?<\/style>/gi,
      ""
    )

    .replace(
      /<[^>]+>/g,
      " "
    )

    .replace(
      /\s+/g,
      " "
    )

    .trim();
}
