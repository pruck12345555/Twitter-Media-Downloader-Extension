/**
 * Twitter Media Downloader - In-Page Twitter Network & React Interceptor
 * Runs 100% locally in the browser to extract media directly from Twitter's own client.
 * Zero third-party APIs. Zero external tracking.
 */

import { selectHighestBitrateVideo, getSyndicationToken, parseMediaFromSyndication } from '../utils/video.js';
import {
  extractImageUrls,
  hasVideoMedia,
  getVideoContainers,
  toOriginalImageUrl,
  getMediaCanonicalKey
} from './extractor.js';

// Global in-memory cache for media captured directly from Twitter's own GraphQL / XHR responses
if (typeof window !== 'undefined') {
  window.__TMD_MEDIA_CACHE__ = window.__TMD_MEDIA_CACHE__ || new Map();
}

/**
 * Extracts video items and photos from a media list.
 * Normalizes all photo URLs to original quality (name=orig).
 * @param {Array} mediaList
 * @returns {Array<{ type: string, url: string }>}
 */
export function extractItemsFromMedia(mediaList) {
  if (!Array.isArray(mediaList)) return [];
  const items = [];
  for (const m of mediaList) {
    if (!m || typeof m !== 'object') continue;

    if (m.video_info?.variants || m.type === 'video' || m.type === 'animated_gif') {
      const variants = m.video_info?.variants || [];
      const mp4s = variants.filter(
        (v) => v && v.content_type === 'video/mp4' && typeof v.url === 'string'
      );
      if (mp4s.length > 0) {
        mp4s.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        items.push({ type: 'video', url: mp4s[0].url });
      } else if (variants[0]?.url) {
        items.push({ type: 'video', url: variants[0].url });
      }
    } else if (m.type === 'photo' || m.media_url_https) {
      const url = m.media_url_https || m.url;
      if (url) {
        items.push({ type: 'image', url: toOriginalImageUrl(url) });
      }
    }
  }
  return items;
}

/**
 * Adds media items into the global in-memory cache deduplicated by canonical media key.
 * @param {string} tweetId
 * @param {Array<{ type: string, url: string }>} newItems
 */
export function addItemsToCache(tweetId, newItems) {
  if (!tweetId || !Array.isArray(newItems) || newItems.length === 0) return;
  if (typeof window === 'undefined' || !window.__TMD_MEDIA_CACHE__) return;

  const existing = window.__TMD_MEDIA_CACHE__.get(String(tweetId)) || [];
  const map = new Map();

  for (const it of existing) {
    if (it && it.url) {
      const norm = it.type === 'image' ? toOriginalImageUrl(it.url) : it.url;
      const key = getMediaCanonicalKey(norm);
      map.set(key, { ...it, url: norm });
    }
  }

  for (const it of newItems) {
    if (it && it.url) {
      const norm = it.type === 'image' ? toOriginalImageUrl(it.url) : it.url;
      const key = getMediaCanonicalKey(norm);
      map.set(key, { ...it, url: norm });
    }
  }

  window.__TMD_MEDIA_CACHE__.set(String(tweetId), Array.from(map.values()));
}

/**
 * Recursively scans a Twitter GraphQL response object for media entities (videos, photos, gifs)
 * including unified_cards and amplify videos, storing them in local memory cache by tweet ID.
 * @param {Object} data
 */
export function scanAndCacheTwitterGraphQL(data) {
  if (!data || typeof data !== 'object') return;

  const visited = new Set();

  function traverse(obj, depth = 0, currentTweetId = null) {
    if (!obj || typeof obj !== 'object' || depth > 25 || visited.has(obj)) {
      return;
    }
    visited.add(obj);

    const tweetId = obj.rest_id || obj.id_str || (typeof obj.id === 'string' ? obj.id : currentTweetId);

    // 1. Check standard media lists
    const rawMedia =
      obj.extended_entities?.media ||
      obj.legacy?.extended_entities?.media ||
      obj.legacy?.entities?.media ||
      obj.entities?.media ||
      (obj.media_entities ? Object.values(obj.media_entities) : null);

    if (tweetId && Array.isArray(rawMedia) && rawMedia.length > 0) {
      const items = extractItemsFromMedia(rawMedia);
      if (items.length > 0) {
        addItemsToCache(tweetId, items);
      }
    }

    // 2. Check cards and unified_card (for amplify videos and interactive media)
    if (obj.card?.legacy?.binding_values) {
      const bv = obj.card.legacy.binding_values;
      const values = Array.isArray(bv) ? bv : Object.values(bv);
      for (const entry of values) {
        const valStr = entry?.value?.string_value;
        if (typeof valStr === 'string' && (valStr.includes('video_info') || valStr.includes('media_entities'))) {
          try {
            const parsed = JSON.parse(valStr);
            traverse(parsed, depth + 1, tweetId);
          } catch {}
        }
      }
    }

    // 3. Direct video_info attached to an object
    if (tweetId && obj.video_info && Array.isArray(obj.video_info.variants)) {
      const items = extractItemsFromMedia([obj]);
      if (items.length > 0) {
        addItemsToCache(tweetId, items);
      }
    }

    // Traverse children
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        traverse(obj[key], depth + 1, tweetId);
      }
    }
  }

  traverse(data);
}

/**
 * Safely extracts video and media items from a specific Twitter data or React props object.
 * Fast O(1) checks directly against Twitter data schemas without runaway graph traversal.
 * @param {Object} obj
 * @returns {Array<{ type: 'video'|'image', url: string }>}
 */
export function extractMediaFromObject(obj) {
  if (!obj || typeof obj !== 'object' || obj.nodeType) return [];

  const results = [];
  const seenUrls = new Set();

  const add = (item) => {
    if (item && item.url && !seenUrls.has(item.url)) {
      seenUrls.add(item.url);
      results.push(item);
    }
  };

  // 1. Direct media array (extended_entities.media, legacy, etc.)
  const mediaList =
    obj.extended_entities?.media ||
    obj.legacy?.extended_entities?.media ||
    obj.legacy?.entities?.media ||
    obj.entities?.media ||
    (Array.isArray(obj.media) ? obj.media : null);

  if (Array.isArray(mediaList)) {
    const items = extractItemsFromMedia(mediaList);
    for (const it of items) add(it);
  }

  // 2. Direct video_info
  const vInfo =
    obj.video_info ||
    obj.playerState?.video_info ||
    obj.media_entity?.video_info ||
    obj.media?.video_info;

  if (vInfo && Array.isArray(vInfo.variants)) {
    const best = selectHighestBitrateVideo(vInfo.variants);
    if (best) add({ type: 'video', url: best });
  }

  // 3. Direct variants array
  if (Array.isArray(obj.variants) && obj.variants[0]?.content_type) {
    const best = selectHighestBitrateVideo(obj.variants);
    if (best) add({ type: 'video', url: best });
  }

  // 4. Unified card / amplify card
  if (obj.card?.legacy?.binding_values) {
    const bv = obj.card.legacy.binding_values;
    const values = Array.isArray(bv) ? bv : Object.values(bv);
    for (const entry of values) {
      const valStr = entry?.value?.string_value;
      if (typeof valStr === 'string' && (valStr.includes('video_info') || valStr.includes('media_entities'))) {
        try {
          const parsed = JSON.parse(valStr);
          const cardItems = extractMediaFromObject(parsed);
          for (const it of cardItems) add(it);
        } catch {}
      }
    }
  }

  // 5. Check nested tweet wrapper
  const nestedTweet =
    obj.tweet ||
    obj.itemContent?.tweet_results?.result ||
    obj.tweet_results?.result;
  if (nestedTweet && typeof nestedTweet === 'object' && nestedTweet !== obj) {
    const nestedItems = extractMediaFromObject(nestedTweet);
    for (const it of nestedItems) add(it);
  }

  return results;
}

/**
 * Inspects any arbitrary JS object or React fiber/props structure for video variants.
 * @param {Object} rootObj
 * @returns {Array<{ content_type: string, bitrate?: number, url: string }>|null}
 */
export function inspectObjectForVariants(rootObj) {
  if (!rootObj || typeof rootObj !== 'object') return null;

  if (rootObj.video_info && Array.isArray(rootObj.video_info.variants)) {
    return rootObj.video_info.variants;
  }
  if (Array.isArray(rootObj.variants) && rootObj.variants[0]?.content_type) {
    return rootObj.variants;
  }

  const items = extractMediaFromObject(rootObj);
  const vid = items.find((m) => m.type === 'video');
  if (vid) {
    return [{ content_type: 'video/mp4', url: vid.url }];
  }

  // Safe shallow fallback (max 30 iterations, strictly skips DOM and window)
  const visited = new Set();
  const queue = [rootObj];
  let it = 0;
  while (queue.length > 0 && it < 30) {
    it++;
    const curr = queue.shift();
    if (!curr || typeof curr !== 'object' || visited.has(curr)) continue;
    visited.add(curr);

    if (curr.video_info && Array.isArray(curr.video_info.variants)) {
      return curr.video_info.variants;
    }
    if (Array.isArray(curr.variants) && curr.variants[0]?.content_type) {
      return curr.variants;
    }

    const found = extractMediaFromObject(curr);
    const v = found.find((m) => m.type === 'video');
    if (v) return [{ content_type: 'video/mp4', url: v.url }];

    if (Array.isArray(curr)) {
      for (const el of curr) {
        if (el && typeof el === 'object' && !el.nodeType) queue.push(el);
      }
      continue;
    }

    try {
      for (const k of Object.keys(curr)) {
        if (k === 'stateNode' || k === 'window' || k === 'document' || k === '_owner') continue;
        const val = curr[k];
        if (val && typeof val === 'object' && !val.nodeType && typeof val !== 'function') {
          queue.push(val);
        }
      }
    } catch {}
  }

  return null;
}

/**
 * Inspects any arbitrary JS object or React fiber/props structure for ALL media items.
 * @param {Object} rootObj
 * @returns {Array<{ type: 'video'|'image', url: string }>}
 */
export function inspectObjectForAllMediaItems(rootObj) {
  if (!rootObj || typeof rootObj !== 'object') return [];

  const directItems = extractMediaFromObject(rootObj);
  if (directItems.length > 0) return directItems;

  const visited = new Set();
  const queue = [rootObj];
  const items = [];
  const seenUrls = new Set();
  let iterations = 0;

  while (queue.length > 0 && iterations < 30) {
    iterations++;
    const current = queue.shift();
    if (!current || typeof current !== 'object' || visited.has(current)) {
      continue;
    }
    visited.add(current);

    const found = extractMediaFromObject(current);
    for (const it of found) {
      if (it.url && !seenUrls.has(it.url)) {
        seenUrls.add(it.url);
        items.push(it);
      }
    }
    if (items.length > 0) break;

    if (Array.isArray(current)) {
      for (let i = 0; i < current.length && i < 15; i++) {
        const el = current[i];
        if (el && typeof el === 'object' && !el.nodeType) {
          queue.push(el);
        }
      }
      continue;
    }

    try {
      for (const key of Object.keys(current)) {
        if (key === 'stateNode' || key === 'window' || key === 'document' || key === '_owner') continue;
        const val = current[key];
        if (val && typeof val === 'object' && !val.nodeType && typeof val !== 'function') {
          queue.push(val);
        }
      }
    } catch {}
  }

  return items;
}

/**
 * Searches React internal properties on a DOM element for video variants.
 * Climbs the Fiber parent tree (fiber.return) and checks Props and State.
 * @param {Element} domNode
 * @returns {Array<{ content_type: string, bitrate?: number, url: string }>|null}
 */
export function extractVideoFromReactNode(domNode) {
  if (!domNode) return null;

  const targetNodes = [
    domNode.tagName === 'VIDEO' ? domNode : domNode.querySelector?.('video'),
    domNode.querySelector?.('[data-testid="videoPlayer"]'),
    domNode.querySelector?.('[data-testid="videoComponent"]'),
    domNode
  ].filter(Boolean);

  for (const node of targetNodes) {
    // 1. Inspect __reactProps$
    try {
      const propsKey = Object.keys(node).find((k) => k.startsWith('__reactProps$'));
      if (propsKey && node[propsKey]) {
        const variants = inspectObjectForVariants(node[propsKey]);
        if (variants) return variants;
      }
    } catch {}

    // 2. Walk Fiber tree upwards from node
    try {
      const fiberKey = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
      if (fiberKey) {
        let fiber = node[fiberKey];
        let depth = 0;
        while (fiber && depth < 35) {
          const variants =
            (fiber.memoizedProps ? inspectObjectForVariants(fiber.memoizedProps) : null) ||
            (fiber.memoizedState ? inspectObjectForVariants(fiber.memoizedState) : null) ||
            (fiber.pendingProps ? inspectObjectForVariants(fiber.pendingProps) : null);
          if (variants) return variants;
          fiber = fiber.return;
          depth++;
        }
      }
    } catch {}
  }

  return null;
}

/**
 * Scans existing <script> tags in the page for server-rendered initial state
 */
export function scanPageScriptTags() {
  if (typeof document === 'undefined') return;
  try {
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      const text = s.textContent || '';
      if (text.includes('video_info') && (text.includes('variants') || text.includes('bitrate'))) {
        try {
          const match = text.match(/\{.*"video_info".*\}/s);
          if (match) {
            const parsed = JSON.parse(match[0]);
            scanAndCacheTwitterGraphQL(parsed);
          }
        } catch {
          try {
            const parsed = JSON.parse(text);
            scanAndCacheTwitterGraphQL(parsed);
          } catch {}
        }
      }
    }
  } catch {}
}

/**
 * Extracts CSRF token from document.cookie
 * @returns {string}
 */
export function getCsrfToken() {
  if (typeof document === 'undefined' || !document.cookie) return '';
  const match = document.cookie.match(/(?:^|;\s*)ct0=([a-f0-9]+)/i);
  return match ? match[1] : '';
}

/**
 * Direct authenticated in-page query to Twitter's internal API using user's logged-in session.
 * Zero third-party proxies. 100% first-party authenticated request between browser and x.com.
 * @param {string} tweetId
 * @returns {Promise<string|null>}
 */
export async function fetchTweetFromInternalTwitterApi(tweetId) {
  if (!tweetId || typeof fetch === 'undefined') return null;

  try {
    const ct0 = getCsrfToken();
    const headers = {
      'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'
    };
    if (ct0) {
      headers['x-csrf-token'] = ct0;
      headers['x-twitter-active-user'] = 'yes';
      headers['x-twitter-auth-type'] = 'OAuth2Session';
    }

    const endpoint = `https://x.com/i/api/1.1/statuses/show.json?id=${tweetId}&include_entities=true&tweet_mode=extended`;
    const res = await fetch(endpoint, {
      credentials: 'include',
      headers
    });

    if (res.ok) {
      const data = await res.json();
      scanAndCacheTwitterGraphQL(data);
      if (typeof window !== 'undefined' && window.__TMD_MEDIA_CACHE__) {
        const cached = window.__TMD_MEDIA_CACHE__.get(String(tweetId));
        const vid = cached?.find((m) => m.type === 'video');
        if (vid && vid.url) return vid.url;
      }
    }
  } catch {}

  return null;
}

/**
 * Extracts all distinct video MP4 variants from a tweet element (supports 1 to 4 videos)
 * @param {Element} tweetElement
 * @returns {Array<{ url: string, type: 'video' }>}
 */
export function extractAllVideosFromTweet(tweetElement) {
  if (!tweetElement) return [];

  const foundUrls = new Set();
  const results = [];

  const add = (url) => {
    if (url && typeof url === 'string' && !foundUrls.has(url)) {
      foundUrls.add(url);
      results.push({ type: 'video', url });
    }
  };

  const isDirect = (el) => {
    const q = el.closest?.('[data-testid="quoteTweet"], [data-testid="quoteTweetWrapper"]');
    return !q || q === tweetElement;
  };

  const directVideos = Array.from(tweetElement.querySelectorAll?.('video') || []).filter(isDirect);
  const directPlayers = Array.from(tweetElement.querySelectorAll?.('[data-testid="videoPlayer"]') || []).filter(isDirect);
  const directComponents = Array.from(tweetElement.querySelectorAll?.('[data-testid="videoComponent"]') || []).filter(isDirect);

  const targets = [...directVideos, ...directPlayers, ...directComponents, tweetElement];

  for (const node of targets) {
    if (!node) continue;

    // A. Direct <video src> or <source src> check
    try {
      const v = node.tagName === 'VIDEO' ? node : node.querySelector?.('video');
      if (v) {
        const src = v.getAttribute?.('src') || v.src || '';
        if (src.startsWith('http') && src.includes('.mp4')) {
          add(src);
        }
        const sources = v.querySelectorAll?.('source') || [];
        for (const s of sources) {
          const sSrc = s.getAttribute?.('src') || s.src || '';
          if (sSrc.startsWith('http') && sSrc.includes('.mp4')) {
            add(sSrc);
          }
        }
      }
    } catch {}

    // B. React Props
    try {
      const propsKey = Object.keys(node).find((k) => k.startsWith('__reactProps$'));
      if (propsKey && node[propsKey]) {
        const items = extractMediaFromObject(node[propsKey]);
        for (const it of items) {
          if (it.type === 'video') add(it.url);
        }
      }
    } catch {}

    // C. React Fiber tree
    try {
      const fiberKey = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
      if (fiberKey && node[fiberKey]) {
        let fiber = node[fiberKey];
        let depth = 0;
        while (fiber && depth < 35) {
          if (fiber.memoizedProps) {
            const items = extractMediaFromObject(fiber.memoizedProps);
            for (const it of items) {
              if (it.type === 'video') add(it.url);
            }
          }
          if (fiber.memoizedState) {
            const items = extractMediaFromObject(fiber.memoizedState);
            for (const it of items) {
              if (it.type === 'video') add(it.url);
            }
          }
          fiber = fiber.return;
          depth++;
        }
      }
    } catch {}

    // D. Fallback via extractVideoFromReactNode
    try {
      const variants = extractVideoFromReactNode(node);
      if (Array.isArray(variants) && variants.length > 0) {
        const best = selectHighestBitrateVideo(variants);
        if (best) add(best);
      }
    } catch {}
  }

  return results;
}

/**
 * Resolves all media assets (images and videos) for a tweet.
 * Full support for multi-video tweets (1 to 4 videos), multi-image tweets, and mixed-media posts.
 * Normalizes all photo URLs to original resolution and strictly deduplicates by canonical media key.
 * @param {Element} tweetElement
 * @param {string} tweetId
 * @returns {Promise<Array<{ type: 'video'|'image', url: string, element?: Element }>>}
 */
export async function resolveAllTweetMedia(tweetElement, tweetId) {
  scanPageScriptTags();

  const mediaMap = new Map(); // key = canonical media key, val = { type, url, element? }

  const addMedia = (item, element) => {
    if (!item || !item.url) return;
    const normUrl = item.type === 'image' ? toOriginalImageUrl(item.url) : item.url;
    const key = getMediaCanonicalKey(normUrl);
    const existing = mediaMap.get(key);
    mediaMap.set(key, {
      type: item.type,
      url: normUrl,
      element: element || existing?.element
    });
  };

  // 1. Check in-memory cache (captured from Twitter's own GraphQL / XHR responses)
  if (tweetId && typeof window !== 'undefined' && window.__TMD_MEDIA_CACHE__) {
    const cached = window.__TMD_MEDIA_CACHE__.get(String(tweetId));
    if (Array.isArray(cached) && cached.length > 0) {
      for (const item of cached) {
        addMedia(item);
      }
    }
  }

  // 2. Extract DOM images (excluding quote tweets)
  const images = extractImageUrls(tweetElement);
  for (const img of images) {
    addMedia({ type: 'image', url: img.url }, img.element);
  }

  // 3. Extract videos from React Fiber tree, DOM video elements, and containers
  const isVideoTweet = hasVideoMedia(tweetElement);
  const localVideos = extractAllVideosFromTweet(tweetElement);
  for (const vid of localVideos) {
    addMedia(vid);
  }

  // Cache newly discovered items in __TMD_MEDIA_CACHE__
  if (tweetId && typeof window !== 'undefined' && window.__TMD_MEDIA_CACHE__) {
    const allFound = Array.from(mediaMap.values());
    if (allFound.length > 0) {
      addItemsToCache(tweetId, allFound);
    }
  }

  // 4. Count video containers in the DOM to know expected video count
  const videoContainers = getVideoContainers(tweetElement);
  const expectedVideoCount = isVideoTweet ? Math.max(1, videoContainers.length) : 0;
  let currentVideoCount = Array.from(mediaMap.values()).filter((m) => m.type === 'video').length;

  // 5. If expected videos not fully resolved, query Twitter's internal API with active session
  if (currentVideoCount < expectedVideoCount && tweetId && typeof fetch !== 'undefined') {
    await fetchTweetFromInternalTwitterApi(tweetId);
    if (typeof window !== 'undefined' && window.__TMD_MEDIA_CACHE__) {
      const cached = window.__TMD_MEDIA_CACHE__.get(String(tweetId));
      if (Array.isArray(cached) && cached.length > 0) {
        for (const item of cached) {
          addMedia(item);
        }
      }
    }
    currentVideoCount = Array.from(mediaMap.values()).filter((m) => m.type === 'video').length;
  }

  // 6. Direct in-page Twitter syndication fallback (100% first-party official endpoint)
  if (currentVideoCount < expectedVideoCount && tweetId && typeof fetch !== 'undefined') {
    try {
      const token = getSyndicationToken(tweetId);
      const synUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=${token}`;
      const synRes = await fetch(synUrl);
      if (synRes.ok) {
        const synData = await synRes.json();
        const synItems = parseMediaFromSyndication(synData);
        for (const item of synItems) {
          addMedia(item);
        }
      }
    } catch {}
    currentVideoCount = Array.from(mediaMap.values()).filter((m) => m.type === 'video').length;
  }

  // 7. Fallback to background service worker if chrome.runtime is available
  if (currentVideoCount < expectedVideoCount && tweetId && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: 'FETCH_TWEET_MEDIA', tweetId },
          (res) => resolve(res)
        );
      });
      if (Array.isArray(response?.media)) {
        for (const item of response.media) {
          addMedia(item);
        }
      }
    } catch {}
  }

  return Array.from(mediaMap.values());
}

/**
 * Intercepts window.fetch directly in Twitter's web client to capture Twitter's own GraphQL responses.
 */
export function installTwitterFetchInterceptor() {
  if (typeof window === 'undefined' || !window.fetch || window.__TMD_INTERCEPTOR_INSTALLED__) {
    return;
  }
  window.__TMD_INTERCEPTOR_INSTALLED__ = true;

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (
        url.includes('/graphql/') ||
        url.includes('/i/api/') ||
        url.includes('api.twitter.com') ||
        url.includes('api.x.com')
      ) {
        const clone = response.clone();
        clone
          .json()
          .then((data) => {
            scanAndCacheTwitterGraphQL(data);
          })
          .catch(() => {});
      }
    } catch {}
    return response;
  };
}

/**
 * Intercepts XMLHttpRequest directly in Twitter's web client.
 */
export function installTwitterXHRInterceptor() {
  if (typeof window === 'undefined' || !window.XMLHttpRequest || window.__TMD_XHR_INTERCEPTED__) {
    return;
  }
  window.__TMD_XHR_INTERCEPTED__ = true;

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__tmd_url = typeof url === 'string' ? url : url?.toString() || '';
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        const url = this.__tmd_url || '';
        if (
          url.includes('/graphql/') ||
          url.includes('/i/api/') ||
          url.includes('api.twitter.com') ||
          url.includes('api.x.com')
        ) {
          if (this.responseText) {
            const data = JSON.parse(this.responseText);
            scanAndCacheTwitterGraphQL(data);
          }
        }
      } catch {}
    });
    return originalSend.apply(this, args);
  };
}

// Automatically install fetch and XHR interceptors in browser environment
if (typeof window !== 'undefined') {
  installTwitterFetchInterceptor();
  installTwitterXHRInterceptor();
  scanPageScriptTags();
}
