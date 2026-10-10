/**
 * Twitter Media Downloader - System Download via High-Speed Blob Link
 * Uses multi-stream concurrent Range requests to maximize CDN download speed,
 * then saves via same-origin Blob URLs to preserve OS last-used directory memory.
 */

/**
 * Maps a file extension to its corresponding MIME type
 * @param {string} ext
 * @returns {string}
 */
export function getMimeType(ext) {
  const clean = (ext || '').replace(/^\.+/, '').toLowerCase();
  switch (clean) {
    case 'png':
      return 'image/png';
    case 'mp4':
      return 'video/mp4';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'jpg':
    case 'jpeg':
    default:
      return 'image/jpeg';
  }
}

/**
 * Downloads a single stream using ReadableStream to report live byte progress
 * @param {Response} res
 * @param {number} totalBytes
 * @param {Function} [onProgress]
 * @returns {Promise<Blob>}
 */
async function readResponseWithProgress(res, totalBytes, onProgress) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const blob = await res.blob();
    if (onProgress) onProgress(1);
    return blob;
  }

  const reader = res.body.getReader();
  const chunks = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedBytes += value.length;
    if (onProgress && totalBytes > 0) {
      onProgress(Math.min(0.99, receivedBytes / totalBytes));
    }
  }

  if (onProgress) onProgress(1);
  const mimeType = res.headers.get('content-type') || 'application/octet-stream';
  return new Blob(chunks, { type: mimeType });
}

/**
 * Multi-threaded parallel chunk downloader for large files (videos).
 * Opens multiple concurrent HTTP Range streams to bypass Twitter CDN single-stream throttling.
 *
 * @param {string} url - Direct media URL
 * @param {Object} [options]
 * @param {number} [options.concurrency=6] - Number of parallel streams
 * @param {Function} [options.onProgress] - Callback (ratio: 0 to 1)
 * @returns {Promise<Blob>}
 */
export async function downloadInParallel(url, options = {}) {
  const concurrency = options.concurrency || 6;
  const onProgress = options.onProgress;

  let totalBytes = 0;
  let supportsRange = false;

  // 1. Probe for Range support and Content-Length (HEAD request first, Range fallback)
  try {
    const headRes = await fetch(url, { method: 'HEAD' });
    if (headRes.ok) {
      const len = headRes.headers.get('content-length');
      if (len) totalBytes = parseInt(len, 10);
      if (headRes.headers.get('accept-ranges') === 'bytes') {
        supportsRange = true;
      }
    }
  } catch {}

  if (!totalBytes || !supportsRange) {
    try {
      const probeRes = await fetch(url, {
        headers: { Range: 'bytes=0-0' }
      });

      if (probeRes.status === 206) {
        supportsRange = true;
        const contentRange = probeRes.headers.get('content-range');
        if (contentRange) {
          const match = contentRange.match(/\/(\d+)/);
          if (match) {
            totalBytes = parseInt(match[1], 10);
          }
        }
      } else if (probeRes.ok) {
        const lengthHeader = probeRes.headers.get('content-length');
        if (lengthHeader) {
          totalBytes = parseInt(lengthHeader, 10);
        }
        if (probeRes.headers.get('accept-ranges') === 'bytes') {
          supportsRange = true;
        }
      }
    } catch {}
  }

  // 2. If file is small (< 3MB) or Range is unsupported, download as single stream
  if (!supportsRange || totalBytes < 3 * 1024 * 1024) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const length = parseInt(res.headers.get('content-length') || '0', 10) || totalBytes;
    return await readResponseWithProgress(res, length, onProgress);
  }

  // 3. Multi-stream parallel download
  const chunkSize = Math.ceil(totalBytes / concurrency);
  const chunkBuffers = new Array(concurrency);
  const loadedPerChunk = new Array(concurrency).fill(0);

  const reportTotalProgress = () => {
    if (!onProgress || totalBytes <= 0) return;
    const totalLoaded = loadedPerChunk.reduce((a, b) => a + b, 0);
    onProgress(Math.min(0.99, totalLoaded / totalBytes));
  };

  const downloadChunk = async (index) => {
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize - 1, totalBytes - 1);
    if (start >= totalBytes) return;

    const res = await fetch(url, {
      headers: { Range: `bytes=${start}-${end}` }
    });

    if (!res.ok && res.status !== 206) {
      throw new Error(`Chunk ${index} failed: HTTP ${res.status}`);
    }

    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const parts = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        loadedPerChunk[index] += value.length;
        reportTotalProgress();
      }
      chunkBuffers[index] = new Blob(parts);
    } else {
      const buffer = await res.arrayBuffer();
      chunkBuffers[index] = buffer;
      loadedPerChunk[index] = buffer.byteLength;
      reportTotalProgress();
    }
  };

  // Launch all concurrent streams in parallel
  await Promise.all(
    Array.from({ length: concurrency }, (_, i) => downloadChunk(i))
  );

  if (onProgress) onProgress(1);

  const isVideo = url.includes('.mp4');
  const mimeType = isVideo ? 'video/mp4' : 'application/octet-stream';
  return new Blob(chunkBuffers.filter(Boolean), { type: mimeType });
}

/**
 * Fetches media as a Blob, using high-speed parallel range requests for videos
 * @param {string} url
 * @param {Function} [onProgress]
 * @returns {Promise<Blob>}
 */
export async function fetchMediaBlob(url, onProgress) {
  try {
    // For videos or twimg video CDN, use multi-stream parallel acceleration
    if (url.includes('.mp4') || url.includes('video.twimg.com')) {
      try {
        return await downloadInParallel(url, { concurrency: 6, onProgress });
      } catch (err) {
        console.warn('[Twitter Media Downloader] Parallel download failed, falling back to single stream:', err);
      }
    }

    let res = await fetch(url);
    if (!res.ok && url.includes('name=orig')) {
      const fallbackUrl = url.replace('name=orig', 'name=large');
      res = await fetch(fallbackUrl);
    }
    if (res.ok) {
      const length = parseInt(res.headers.get('content-length') || '0', 10);
      return await readResponseWithProgress(res, length, onProgress);
    }
  } catch (err) {
    // If direct in-page fetch is blocked, fallback via background worker
    console.warn('[Twitter Media Downloader] Direct fetch error:', err);
  }

  // Fallback to service worker if running in isolated world
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      reject(new Error('Cannot fetch media: direct fetch failed and runtime unavailable'));
      return;
    }

    chrome.runtime.sendMessage(
      { action: 'FETCH_BLOB_DATA', url },
      (response) => {
        if (response && response.success && response.base64) {
          try {
            const byteCharacters = atob(response.base64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: response.mimeType || 'application/octet-stream' });
            if (onProgress) onProgress(1);
            resolve(blob);
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error(response?.error || 'Failed to fetch blob via background'));
        }
      }
    );
  });
}

/**
 * Triggers a download using a same-origin Blob link with live progress reporting.
 * Chrome natively mounts the Save As dialog on the system's most recent download path.
 *
 * @param {Object} options
 * @param {string} options.url - Source media URL
 * @param {string} options.filename - Sanitized caption filename
 * @param {Function} [options.onProgress] - Progress callback (ratio: 0 to 1)
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function downloadWithSystemPath({ url, filename, onProgress }) {
  try {
    const blob = await fetchMediaBlob(url, onProgress);
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(blobUrl);
    }, 2000);

    return { success: true };
  } catch (err) {
    console.error('[Twitter Media Downloader] Error downloading media:', err);
    return { success: false, error: err.message || String(err) };
  }
}
