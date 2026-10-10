# Twitter Media Downloader

A privacy-first Chrome Manifest V3 browser extension that enables high-speed, one-click downloading of images and videos from Twitter/X posts, automatically named using the original sanitized post caption.

## Key Features

- **System-Wide Recent Save Path Memory**: Downloads use native in-page same-origin `Blob` links, allowing the OS "Save As" file dialog to automatically remember and mount on your system's most recent download directory (matching Telegram Web Downloader).
- **High-Speed Parallel Range Downloads**: Opens 6 concurrent HTTP Range streams to bypass Twitter CDN speed throttling (~20–30s downloads instead of 3 minutes for 1080p videos).
- **Live Progress Counter**: Displays real-time download percentage (`15%` → `48%` → `85%` → `100%`) directly inside the button.
- **100% Private & First-Party**: Zero third-party proxy servers, zero analytics, zero external logging. All traffic is strictly between your browser and official Twitter/X endpoints.
- **NSFW & Age-Restricted Tweet Support**: Resolves media for sensitive and age-restricted tweets in-memory via React Fiber climbing and direct authenticated session queries (`ct0` CSRF token), completely bypassing unauthenticated syndication tombstones.
- **Action Bar Download Button**: Directly on each tweet's action bar to download all attached media.
- **Media Overlay Buttons**: Subtle hover button on individual photos/videos for single-item saving.
- **Caption-Based Filenames**: Automatically cleans URLs and illegal filesystem characters, truncating to ~100 characters.
- **Smart Indexing**:
  - Single media: `{caption}.{ext}`
  - Multiple media: `{caption}_1.{ext}`, `{caption}_2.{ext}`, etc.
  - Blank caption fallback: `@{author}_{tweet_id}.{ext}`
- **Original Quality**: Fetches images at source resolution (`name=orig`) and videos at highest available bitrate MP4.
- **Conflict Resolution**: Uses `uniquify` to avoid accidental overwrites.
- **Quote Tweet Isolation**: Excludes media inside quoted tweets.

## Installation in Chrome / Chromium (Edge, Brave)

1. Open `chrome://extensions` in your browser.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select this directory 
5. Navigate to [x.com](https://x.com) or [twitter.com](https://twitter.com) and browse your feed!

## Development & Testing

- Run automated tests: `npm test` or `node --test tests/*.test.mjs` (38 passing tests)
- Rebuild content script bundle: `npm run build` or `node scripts/build.mjs`
- Regenerate icons: `npm run icons` or `node scripts/generate-icons.mjs`
