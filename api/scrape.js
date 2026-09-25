// api/scrape.js

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  const officialOrigin = "https://zxh-official-mdfire-dl.vercel.app";
  const origin = String(req.headers.origin || "");

  // --------------------------------------------------
  // CORS / BROWSER ACCESS CONTROL
  // --------------------------------------------------
  //
  // Same-origin requests from the official website normally
  // do not need CORS. If an Origin header exists, only the
  // official website is accepted.
  //
  // This blocks normal browser-based requests coming from
  // copied external frontends.
  //
  if (origin) {
    if (origin !== officialOrigin) {
      res.setHeader("Access-Control-Allow-Origin", officialOrigin);
      res.setHeader("Vary", "Origin");

      return res.status(403).json({
        success: false,
        error: "ZXH OFFICIAL API is private."
      });
    }

    res.setHeader("Access-Control-Allow-Origin", officialOrigin);
    res.setHeader("Vary", "Origin");
  }

  // --------------------------------------------------
  // METHOD CHECK
  // --------------------------------------------------

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  try {
    // --------------------------------------------------
    // GET URL
    // --------------------------------------------------

    const rawUrl = req.query?.url;

    if (!rawUrl) {
      return res.status(400).json({
        success: false,
        error: "MediaFire URL is required."
      });
    }

    // --------------------------------------------------
    // PARSE URL
    // --------------------------------------------------

    let mediafireUrl;

    try {
      mediafireUrl = new URL(String(rawUrl).trim());
    } catch {
      return res.status(400).json({
        success: false,
        error: "Invalid URL."
      });
    }

    // --------------------------------------------------
    // HTTPS ONLY
    // --------------------------------------------------

    if (mediafireUrl.protocol !== "https:") {
      return res.status(400).json({
        success: false,
        error: "Only HTTPS MediaFire URLs are supported."
      });
    }

    // --------------------------------------------------
    // MEDIAFIRE HOST CHECK
    // --------------------------------------------------

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
    // FETCH MEDIAFIRE PAGE
    // --------------------------------------------------

    const response = await fetch(mediafireUrl.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/131.0.0.0 Safari/537.36",

        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

        "Accept-Language":
          "en-US,en;q=0.9",

        "Cache-Control":
          "no-cache"
      }
    });

    // --------------------------------------------------
    // MEDIAFIRE RESPONSE CHECK
    // --------------------------------------------------

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

    // --------------------------------------------------
    // CLEAN HTML FOR METADATA PARSING
    // --------------------------------------------------

    // Remove scripts/styles/comments before extracting
    // visible metadata. This prevents CSS such as:
    // "Date { color:..." from being detected as upload date.
    const cleanHtml = html
      .replace(/<!--[\s\S]*?-->/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/\s+/g, " ");

    // --------------------------------------------------
    // DOWNLOAD URL
    // --------------------------------------------------

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

    // --------------------------------------------------
    // FALLBACK DOWNLOAD URL SEARCH
    // --------------------------------------------------

    if (!downloadUrl) {
      const allLinks = [
        ...cleanHtml.matchAll(
          /href\s*=\s*["']([^"']+)["']/gi
        )
      ];

      for (const match of allLinks) {
        const href = decodeHtml(match[1]);

        if (
          /download/i.test(href) &&
          /^https?:\/\//i.test(href)
        ) {
          downloadUrl = href;
          break;
        }
      }
    }

    // --------------------------------------------------
    // FILENAME
    // --------------------------------------------------

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
        filename = cleanText(
          decodeHtml(match[1])
        );

        break;
      }
    }

    // Remove MediaFire suffix from title
    filename = filename
      .replace(/\s*[-|]\s*MediaFire.*$/i, "")
      .trim();

    // --------------------------------------------------
    // FILESIZE
    // --------------------------------------------------

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
        filesize = cleanText(
          decodeHtml(match[1])
        );

        break;
      }
    }

    // --------------------------------------------------
    // UPLOAD DATE
    // --------------------------------------------------

    let uploadDate = "";

    // IMPORTANT:
    // Do NOT use generic "Date" matching.
    // MediaFire CSS contains "Date { ... }", which caused
    // the previous parser to return CSS as upload_date.

    const datePatterns = [
      // Uploaded: September 24, 2026
      /(?:Uploaded|Upload\s*Date|Uploaded\s*On)\s*[:\-]?\s*([^<\n]{3,100})/i,

      // Uploaded inside an element
      /class=["'][^"']*(?:upload-date|uploaded|date-uploaded)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,

      // Data attribute variants
      /(?:data-upload-date|data-uploaded)=["']([^"']{3,100})["']/i
    ];

    for (const pattern of datePatterns) {
      const match = cleanHtml.match(pattern);

      if (!match || !match[1]) {
        continue;
      }

      const candidate = cleanText(
        decodeHtml(match[1])
      );

      // ------------------------------------------------
      // Reject obvious CSS / HTML garbage
      // ------------------------------------------------

      const looksLikeCode =
        candidate.includes("{") ||
        candidate.includes("}") ||
        candidate.includes("color:") ||
        candidate.includes("font-") ||
        candidate.includes("@media") ||
        candidate.includes("display:") ||
        candidate.includes("position:") ||
        candidate.includes("<") ||
        candidate.includes(">");

      if (looksLikeCode) {
        continue;
      }

      // Date should not be excessively long
      if (candidate.length > 100) {
        continue;
      }

      // Basic date-like validation
      const looksLikeDate =
        /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/i.test(candidate) ||
        /\b\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4}\b/.test(candidate) ||
        /\b\d{1,2}\s+(?:days?|weeks?|months?|years?)\s+ago\b/i.test(candidate) ||
        /\b\d{4}\b/.test(candidate);

      if (!looksLikeDate) {
        continue;
      }

      uploadDate = candidate;
      break;
    }

    // --------------------------------------------------
    // FILENAME FALLBACK
    // --------------------------------------------------

    if (!filename) {
      const pathParts = mediafireUrl.pathname
        .split("/")
        .filter(Boolean);

      if (pathParts.length) {
        try {
          filename = decodeURIComponent(
            pathParts[pathParts.length - 1]
          );
        } catch {
          filename =
            pathParts[pathParts.length - 1];
        }
      }
    }

    // --------------------------------------------------
    // FINAL RESPONSE
    // --------------------------------------------------

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
      error: "Could not process the MediaFire link."
    });
  }
}


// ======================================================
// HTML ENTITY DECODER
// ======================================================

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


// ======================================================
// TEXT CLEANER
// ======================================================

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
