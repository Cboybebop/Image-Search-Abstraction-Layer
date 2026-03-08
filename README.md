# Image Search Abstraction Layer

A full-stack JavaScript app that exposes an image-search API and a modern UI (dark green theme).

## Run

```bash
npm start
```

Then open `http://localhost:3000`.

## API Endpoints

### Search images

`GET /query/:search?page=2`

- `:search` is any search string (URL-encoded if needed)
- `page` is optional and defaults to `1`
- Returns image URL, description, page URL, and thumbnail for each result

Example:

`/query/lolcats%20funny?page=10`

### Recent searches

`GET /recent/`

Returns the most recent search strings with timestamps.

## Notes

- Image results are sourced from Wikimedia Commons via their public API.
- Recent search history is stored in `data/recent-searches.json`.
- The app is dependency-light and uses built-in Node.js modules only.

## User Stories Implemented

- You can get the image URLs, description and page URLs for a set of images relating to a given search string.
- You can paginate through responses by adding a `?page=2` parameter to the URL.
- You can get a list of the most recently submitted search strings.
- You can click any item in the recent-search list to re-run that query instantly.
- You can share a deep link to the UI using `?q=<term>&page=<n>` so the same search opens automatically.
- You can preview thumbnail images in a responsive card grid and open the source image or source page in one click.

