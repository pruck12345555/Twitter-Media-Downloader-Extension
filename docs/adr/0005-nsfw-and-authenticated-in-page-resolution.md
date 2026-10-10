# 5. NSFW & Authenticated In-Page Media Resolution

## Context
When attempting to download media from sensitive, NSFW, or age-restricted tweets, public unauthenticated endpoints (like `cdn.syndication.twimg.com`) return an unauthenticated payload:
```json
{"__typename":"TweetTombstone","tombstone":{}}
```
This causes unauthenticated downloaders to fail with empty media and trigger an error state. Furthermore, Twitter's web client obfuscates video elements using Media Source Extensions (`blob:https://x.com/...`) without exposing raw MP4 URLs in static HTML.

## Decision
We decided to resolve all media using an authenticated 5-layer in-page resolution pipeline executing in `"world": "MAIN"` at `"run_at": "document_start"`:
1. **Initial Script Tag Scanner**: Scans server-side rendered `<script>` tags on initial page load for embedded tweet metadata.
2. **Dual Fetch & XHR Interceptor**: Monkey-patches both `window.fetch` and `XMLHttpRequest.prototype` to intercept Twitter's internal GraphQL responses (`/graphql/`, `/i/api/`) in real-time and cache MP4 variants in `window.__TMD_MEDIA_CACHE__`.
3. **BFS React Fiber Tree Climber**: Traverses the React Fiber hierarchy (`fiber.return` up to 35 parent levels) using Breadth-First Search across all properties, arrays, and hooks state (`memoizedState`, `memoizedProps`). (Avoids rigid property whitelists that block array indices like `'0'`, `'1'`).
4. **Direct `<video src>`**: Checks for direct MP4 links on `<video>` tags.
5. **Direct Authenticated Session Fallback**: If in-memory inspection misses, performs an authenticated in-page request to `https://x.com/i/api/1.1/statuses/show.json` using `credentials: 'include'` and the user's active session CSRF cookie (`ct0`).

## Consequences
- Age-restricted and sensitive tweets (e.g. `https://x.com/sdgrliceeee1/status/2100143267224633845`) resolve reliably without encountering tombstones.
- Operates 100% locally with zero external network hops or security leaks.
