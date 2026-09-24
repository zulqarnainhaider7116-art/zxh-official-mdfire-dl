export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed."
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

    const response = await fetch(mediafireUrl.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache"
      }
    });

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

    /*
     * ----------------------------------------
     * Extract download URL
     * ----------------------------------------
     */

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
      const match = html.match(pattern);

      if (match && match[1]) {
        downloadUrl = decodeHtml(match[1]);
        break;
      }
    }

    /*
     * Search common MediaFire download-link
     * patterns if the normal selectors fail.
     */

    if (!downloadUrl) {
      const allLinks = [
        ...html.matchAll(
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

    /*
     * ----------------------------------------
     * Filename
     * ----------------------------------------
     */

    let filename = "";

    const filenamePatterns = [
      /property=["']og:title["'][^>]*content=["']([^"']+)["']/i,
      /content=["']([^"']+)["'][^>]*property=["']og:title["']/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i,
      /class=["'][^"']*filename[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i
    ];

    for (const pattern of filenamePatterns) {
      const match = html.match(pattern);

      if (match && match[1]) {
        filename = cleanText(decodeHtml(match[1]));
        break;
      }
    }

    /*
     * Remove common MediaFire title suffixes.
     */

    filename = filename
      .replace(/\s*[-|]\s*MediaFire.*$/i, "")
      .trim();

    /*
     * ----------------------------------------
     * File size
     * ----------------------------------------
     */

    let filesize = "";

    const sizePatterns = [
      /(?:File\s*Size|Size)\s*[:\-]?\s*<\/?[^>]*>\s*([^<]{1,50})/i,
      /(?:File\s*Size|Size)\s*[:\-]\s*([^<\n]{1,50})/i,
      /class=["'][^"']*(?:file-size|filesize)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
      /\b(\d+(?:\.\d+)?\s*(?:KB|MB|GB|TB|B))\b/i
    ];

    for (const pattern of sizePatterns) {
      const match = html.match(pattern);

      if (match && match[1]) {
        filesize = cleanText(decodeHtml(match[1]));
        break;
      }
    }

    /*
     * ----------------------------------------
     * Upload date
     * ----------------------------------------
     */

    let uploadDate = "";

    const datePatterns = [
      /(?:Uploaded|Upload Date|Date)\s*[:\-]?\s*([^<\n]{3,80})/i,
      /class=["'][^"']*(?:upload-date|uploaded)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i
    ];

    for (const pattern of datePatterns) {
      const match = html.match(pattern);

      if (match && match[1]) {
        uploadDate = cleanText(decodeHtml(match[1]));
        break;
      }
    }

    /*
     * ----------------------------------------
     * Fallback filename from URL
     * ----------------------------------------
     */

    if (!filename) {
      const pathParts =
        mediafireUrl.pathname
          .split("/")
          .filter(Boolean);

      if (pathParts.length) {
        filename = decodeURIComponent(
          pathParts[pathParts.length - 1]
        );
      }
    }

    /*
     * ----------------------------------------
     * Return API contract expected by frontend
     * ----------------------------------------
     */

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


/* =========================================
   Helpers
========================================= */

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
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
      }
