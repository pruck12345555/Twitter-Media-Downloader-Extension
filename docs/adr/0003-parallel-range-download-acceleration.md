# 3. Parallel Range Download Acceleration

## Context
Standard single-stream HTTP `fetch(url)` on Twitter's video CDN (`video.twimg.com`) is artificially throttled by the CDN to ~250–350 KB/s. This behavior is designed to match the real-time bitrate of streaming video playback and prevent CDN bandwidth spikes. For a high-bitrate 1080p video of 3 minutes (~50–60 MB), a single-stream download takes nearly 3 minutes, producing a frustrating user experience compared to dedicated tools like FetchV or IDM (which finish in ~30–50 seconds).

## Decision
We decided to implement a multi-stream concurrent Range request engine (`downloadInParallel` in `src/utils/file-saver.js`):
1. The total file size is probed via `HEAD` or a 1-byte probe (`Range: bytes=0-0`).
2. If the file is a video (>3MB) and supports Range requests, the total byte count is divided into **6 equal chunks**.
3. **6 parallel streams** (`Range: bytes=start-end`) are fetched concurrently using `fetch()` and `ReadableStream`.
4. Real-time byte progress is reported back to the UI button as a live percentage counter (`15%` → `50%` → `90%` → `100%`).
5. As chunks complete, they are joined into a single `Blob` in memory (`new Blob(chunks, { type: 'video/mp4' })`) and triggered via native `<a download>`.

## Consequences
- Video download times for 50MB+ 1080p clips drop from ~180 seconds to **~20–30 seconds** (an ~6x speedup).
- The user receives immediate, real-time feedback via the button's percentage counter.
- If Range is unsupported or any chunk fails, the downloader automatically falls back to single-stream download.
