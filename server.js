"use strict";

const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs/promises");

const HOST = "0.0.0.0";
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const RECENT_FILE = path.join(DATA_DIR, "recent-searches.json");
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const PAGE_SIZE = 10;
const MAX_RECENT_SEARCHES = 20;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

let recentSearches = [];

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function sendText(response, statusCode, payload, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

function getPageNumber(rawPage) {
  const parsed = Number.parseInt(rawPage || "1", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
}

function toDescription(title) {
  return String(title || "")
    .replace(/^File:/i, "")
    .replace(/_/g, " ")
    .trim();
}

async function ensureRecentStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(RECENT_FILE);
  } catch {
    await fs.writeFile(RECENT_FILE, "[]", "utf8");
  }
}

async function loadRecentSearches() {
  await ensureRecentStore();
  try {
    const content = await fs.readFile(RECENT_FILE, "utf8");
    const parsed = JSON.parse(content);
    recentSearches = Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT_SEARCHES) : [];
  } catch {
    recentSearches = [];
  }
}

async function persistRecentSearches() {
  await fs.writeFile(RECENT_FILE, JSON.stringify(recentSearches, null, 2), "utf8");
}

function trackRecentSearch(term) {
  recentSearches.unshift({
    term,
    when: new Date().toISOString()
  });
  recentSearches = recentSearches.slice(0, MAX_RECENT_SEARCHES);

  persistRecentSearches().catch((error) => {
    console.error("Failed to save recent searches:", error);
  });
}

async function searchWikimediaImages(search, page) {
  const offset = (page - 1) * PAGE_SIZE;
  const url = new URL(COMMONS_API);

  url.searchParams.set("action", "query");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrsearch", search);
  url.searchParams.set("gsrnamespace", "6");
  url.searchParams.set("gsrlimit", String(PAGE_SIZE));
  url.searchParams.set("gsroffset", String(offset));
  url.searchParams.set("prop", "imageinfo|info");
  url.searchParams.set("iiprop", "url");
  url.searchParams.set("iiurlwidth", "900");
  url.searchParams.set("inprop", "url");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "image-search-abstraction-layer/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Image provider returned status ${response.status}`);
  }

  const payload = await response.json();
  const pages = Object.values(payload?.query?.pages || {});

  pages.sort((a, b) => {
    const first = Number.isFinite(a.index) ? a.index : 0;
    const second = Number.isFinite(b.index) ? b.index : 0;
    return first - second;
  });

  return pages
    .map((entry) => {
      const imageInfo = Array.isArray(entry.imageinfo) ? entry.imageinfo[0] : null;
      const imageUrl = imageInfo?.url || "";
      const thumbnail = imageInfo?.thumburl || imageUrl;
      const pageUrl = entry.fullurl || imageInfo?.descriptionurl || "";

      return {
        url: imageUrl,
        description: toDescription(entry.title),
        pageUrl,
        thumbnail
      };
    })
    .filter((entry) => entry.url && entry.pageUrl);
}

function normalizeStaticPath(pathname) {
  if (pathname === "/") {
    return "index.html";
  }

  return pathname.replace(/^\/+/, "");
}

async function serveStaticFile(pathname, response) {
  const requestedPath = normalizeStaticPath(pathname);
  const resolvedPublic = path.resolve(PUBLIC_DIR);
  const resolvedFile = path.resolve(PUBLIC_DIR, path.normalize(requestedPath));
  const isInPublicDirectory =
    resolvedFile === resolvedPublic || resolvedFile.startsWith(`${resolvedPublic}${path.sep}`);

  if (!isInPublicDirectory) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const stats = await fs.stat(resolvedFile);

    if (stats.isDirectory()) {
      sendText(response, 404, "Not Found");
      return;
    }

    const fileContent = await fs.readFile(resolvedFile);
    const extension = path.extname(resolvedFile).toLowerCase();
    const contentType = MIME_TYPES[extension] || "application/octet-stream";

    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": fileContent.length
    });
    response.end(fileContent);
  } catch {
    sendText(response, 404, "Not Found");
  }
}

async function requestHandler(request, response) {
  if (!request.url) {
    sendText(response, 400, "Bad Request");
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, {
      error: "Method Not Allowed"
    });
    return;
  }

  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = requestUrl.pathname;

  if (pathname === "/recent" || pathname === "/recent/") {
    sendJson(response, 200, recentSearches);
    return;
  }

  if (pathname.startsWith("/query/")) {
    let rawSearch = "";

    try {
      rawSearch = decodeURIComponent(pathname.slice("/query/".length));
    } catch {
      sendJson(response, 400, {
        error: "Malformed search string"
      });
      return;
    }

    const search = rawSearch.trim();

    if (!search) {
      sendJson(response, 400, {
        error: "Search string is required"
      });
      return;
    }

    const page = getPageNumber(requestUrl.searchParams.get("page"));

    try {
      const images = await searchWikimediaImages(search, page);
      trackRecentSearch(search);

      sendJson(response, 200, {
        search,
        page,
        perPage: PAGE_SIZE,
        count: images.length,
        results: images
      });
    } catch (error) {
      console.error("Search request failed:", error);
      sendJson(response, 502, {
        error: "Failed to fetch images from provider"
      });
    }
    return;
  }

  await serveStaticFile(pathname, response);
}

async function startServer() {
  await loadRecentSearches();

  const server = http.createServer((request, response) => {
    requestHandler(request, response).catch((error) => {
      console.error("Unexpected server error:", error);
      sendJson(response, 500, {
        error: "Internal Server Error"
      });
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`Image Search Abstraction Layer running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exitCode = 1;
});
