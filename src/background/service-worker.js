/**
 * Twitter Media Downloader - Background Service Worker
 * Handles download requests and dispatches them via chrome.downloads API,
 * fetches tweet media details from official Twitter endpoints,
 * and fetches media blobs locally without third-party services.
 */

import { parseMediaFromSyndication, getSyndicationToken } from '../utils/video.js';

// Action constants
export const ACTIONS = {
  DOWNLOAD_MEDIA: 'DOWNLOAD_MEDIA',
  BATCH_DOWNLOAD_MEDIA: 'BATCH_DOWNLOAD_MEDIA',
  FETCH_TWEET_MEDIA: 'FETCH_TWEET_MEDIA',
  FETCH_BLOB_DATA: 'FETCH_BLOB_DATA',
  PING: 'PING'
};

/**
 * Initiates a single media download via chrome.downloads
 * @param {Object} item - { url: string, filename: string }
 * @returns {Promise<{ success: boolean, cancelled?: boolean, downloadId?: number, error?: string }>}
 */
export function downloadMediaItem(item) {
  return new Promise((resolve) => {
    if (!item || !item.url || !item.filename) {
      resolve({ success: false, error: 'Missing required url or filename' });
      return;
    }

    try {
      chrome.downloads.download(
        {
          url: item.url,
          filename: item.filename,
          conflictAction: 'uniquify',
          saveAs: true
        },
        (downloadId) => {
          if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message || '';
            const isCancelled = msg.toLowerCase().includes('cancel');
            resolve({
              success: false,
              cancelled: isCancelled,
              error: msg
            });
          } else {
            resolve({
              success: true,
              downloadId
            });
          }
        }
      );
    } catch (err) {
      resolve({
        success: false,
        error: err.message || String(err)
      });
    }
  });
}

/**
 * Downloads multiple media items sequentially
 * @param {Array<{ url: string, filename: string }>} items
 * @returns {Promise<Array<{ success: boolean, cancelled?: boolean, downloadId?: number, error?: string }>>}
 */
export async function batchDownloadMedia(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const results = [];
  for (let i = 0; i < items.length; i++) {
    const res = await downloadMediaItem(items[i]);
    results.push(res);
    if (res.cancelled) {
      break;
    }
    if (i < items.length - 1) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return results;
}

/**
 * Fetches media details directly from Twitter's official syndication endpoint.
 * Zero third-party services.
 *
 * @param {string} tweetId
 * @returns {Promise<{ success: boolean, media: Array<{ type: string, url: string }>, error?: string }>}
 */
export async function fetchTweetMedia(tweetId) {
  if (!tweetId) {
    return { success: false, media: [], error: 'Missing tweetId' };
  }

  try {
    const token = getSyndicationToken(tweetId);
    const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=${token}`;
    const res = await fetch(url);
    if (!res.ok) {
      return { success: false, media: [], error: `Twitter syndication status: ${res.status}` };
    }

    const data = await res.json();
    const media = parseMediaFromSyndication(data);
    return { success: true, media };
  } catch (err) {
    return { success: false, media: [], error: err.message || String(err) };
  }
}

/**
 * Fetches media bytes directly from Twitter's CDN with extension host permissions
 * @param {string} url
 * @returns {Promise<{ success: boolean, base64?: string, mimeType?: string, error?: string }>}
 */
export async function fetchBlobData(url) {
  if (!url) {
    return { success: false, error: 'Missing url' };
  }

  try {
    let res = await fetch(url);
    if (!res.ok && url.includes('name=orig')) {
      const fallbackUrl = url.replace('name=orig', 'name=large');
      res = await fetch(fallbackUrl);
    }

    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
    }

    const mimeType = res.headers.get('content-type') || 'application/octet-stream';
    const buffer = await res.arrayBuffer();

    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);

    return { success: true, base64, mimeType };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

// Runtime message listener for content script communication
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.action) {
      return false;
    }

    if (message.action === ACTIONS.PING) {
      sendResponse({ status: 'ok', version: '1.0.0' });
      return false;
    }

    if (message.action === ACTIONS.DOWNLOAD_MEDIA) {
      downloadMediaItem(message.item)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (message.action === ACTIONS.BATCH_DOWNLOAD_MEDIA) {
      batchDownloadMedia(message.items)
        .then((results) => sendResponse({ success: true, results }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (message.action === ACTIONS.FETCH_TWEET_MEDIA) {
      fetchTweetMedia(message.tweetId)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (message.action === ACTIONS.FETCH_BLOB_DATA) {
      fetchBlobData(message.url)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    return false;
  });
}
