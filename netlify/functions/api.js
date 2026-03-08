"use strict";

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const PAGE_SIZE = 10;
const MAX_RECENT_SEARCHES = 20;

// Netlify Functions are stateless between cold starts.
// This in-memory list is best-effort for recent entries.
let recentSearches = [];

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(payload)
  };
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

function trackRecentSearch(term) {
  recentSearches.unshift({
    term,
    when: new Date().toISOString()
  });

  recentSearches = recentSearches.slice(0, MAX_RECENT_SEARCHES);
}

function getRoutePath(pathname) {
  const prefix = "/.netlify/functions/api";
  if (!pathname.startsWith(prefix)) {
    return pathname;
  }

  const stripped = pathname.slice(prefix.length);
  return stripped || "/";
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

exports.handler = async (event) => {
  if ((event.httpMethod || "GET") !== "GET") {
    return json(405, { error: "Method Not Allowed" });
  }

  const pathname = getRoutePath(event.path || "/");

  if (pathname === "/recent" || pathname === "/recent/") {
    return json(200, recentSearches);
  }

  if (pathname.startsWith("/query/")) {
    let rawSearch = "";

    try {
      rawSearch = decodeURIComponent(pathname.slice("/query/".length));
    } catch {
      return json(400, { error: "Malformed search string" });
    }

    const search = rawSearch.trim();
    if (!search) {
      return json(400, { error: "Search string is required" });
    }

    const page = getPageNumber(event.queryStringParameters?.page);

    try {
      const images = await searchWikimediaImages(search, page);
      trackRecentSearch(search);

      return json(200, {
        search,
        page,
        perPage: PAGE_SIZE,
        count: images.length,
        results: images
      });
    } catch (error) {
      console.error("Search request failed:", error);
      return json(502, { error: "Failed to fetch images from provider" });
    }
  }

  return json(404, { error: "Not Found" });
};