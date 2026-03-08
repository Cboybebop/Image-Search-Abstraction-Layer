const searchForm = document.querySelector("#searchForm");
const searchInput = document.querySelector("#searchInput");
const pageInput = document.querySelector("#pageInput");
const queryPreview = document.querySelector("#queryPreview");
const statusText = document.querySelector("#statusText");
const resultsGrid = document.querySelector("#resultsGrid");
const recentList = document.querySelector("#recentList");
const resultTemplate = document.querySelector("#resultTemplate");

function clearElement(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function buildQueryPath(search, page) {
  return `/query/${encodeURIComponent(search)}?page=${page}`;
}

function formatWhen(isoDate) {
  const value = new Date(isoDate);
  if (Number.isNaN(value.getTime())) {
    return "Unknown time";
  }

  return value.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function setStatus(message) {
  statusText.textContent = message;
}

function renderMessage(message, isError = false) {
  clearElement(resultsGrid);

  const paragraph = document.createElement("p");
  paragraph.className = isError ? "message error" : "message";
  paragraph.textContent = message;
  resultsGrid.appendChild(paragraph);
}

function renderResults(payload) {
  const results = payload.results || [];
  clearElement(resultsGrid);

  if (!results.length) {
    renderMessage("No image matches found for this query.");
    setStatus(`No results for "${payload.search}" (page ${payload.page}).`);
    return;
  }

  for (const item of results) {
    const clone = resultTemplate.content.cloneNode(true);
    const imageLink = clone.querySelector(".image-link");
    const image = clone.querySelector("img");
    const title = clone.querySelector("h3");
    const details = clone.querySelector("p");
    const visitLink = clone.querySelector(".visit-link");

    imageLink.href = item.url;
    image.src = item.thumbnail || item.url;
    image.alt = item.description || "Search result";

    title.textContent = item.description || "Untitled";
    details.textContent = item.pageUrl;

    visitLink.href = item.pageUrl;

    resultsGrid.appendChild(clone);
  }

  setStatus(`Showing ${results.length} results for "${payload.search}" on page ${payload.page}.`);
}

function renderRecentSearches(items) {
  clearElement(recentList);

  if (!Array.isArray(items) || !items.length) {
    const emptyItem = document.createElement("li");
    emptyItem.textContent = "No recent searches yet.";
    recentList.appendChild(emptyItem);
    return;
  }

  for (const item of items) {
    const listItem = document.createElement("li");
    const button = document.createElement("button");
    const time = document.createElement("small");

    button.className = "recent-term";
    button.type = "button";
    button.textContent = item.term;
    button.addEventListener("click", () => {
      searchInput.value = item.term;
      pageInput.value = "1";
      executeSearch(item.term, 1);
    });

    time.className = "recent-time";
    time.textContent = formatWhen(item.when);

    listItem.appendChild(button);
    listItem.appendChild(time);
    recentList.appendChild(listItem);
  }
}

async function requestJson(path) {
  const response = await fetch(path);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }

  return payload;
}

async function refreshRecentSearches() {
  const recent = await requestJson("/recent/");
  renderRecentSearches(recent);
}

function updatePageState(search, page, queryPath) {
  const browserUrl = new URL(window.location.href);
  browserUrl.searchParams.set("q", search);
  browserUrl.searchParams.set("page", String(page));
  history.replaceState({}, "", browserUrl);

  queryPreview.innerHTML = `API request: <code>${queryPath}</code>`;
}

async function executeSearch(search, page) {
  if (!search) {
    return;
  }

  const queryPath = buildQueryPath(search, page);
  updatePageState(search, page, queryPath);
  setStatus(`Searching for "${search}" on page ${page}...`);

  try {
    const payload = await requestJson(queryPath);
    renderResults(payload);
    await refreshRecentSearches();
  } catch (error) {
    renderMessage(error.message || "Search failed.", true);
    setStatus("Search failed. Try again.");
  }
}

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const search = searchInput.value.trim();
  const page = Math.max(1, Number.parseInt(pageInput.value, 10) || 1);
  pageInput.value = String(page);
  executeSearch(search, page);
});

async function initialize() {
  const startupUrl = new URL(window.location.href);
  const initialSearch = startupUrl.searchParams.get("q") || "";
  const initialPage = Math.max(1, Number.parseInt(startupUrl.searchParams.get("page") || "1", 10) || 1);

  pageInput.value = String(initialPage);

  await refreshRecentSearches();

  if (initialSearch) {
    searchInput.value = initialSearch;
    executeSearch(initialSearch, initialPage);
    return;
  }

  queryPreview.innerHTML = "Try: <code>/query/lolcats%20funny?page=2</code>";
}

initialize().catch((error) => {
  renderMessage(error.message || "Could not initialize the app.", true);
});

