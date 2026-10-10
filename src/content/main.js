/**
 * Twitter Media Downloader - Content Script Entry Point
 * 100% local, private media extraction directly from Twitter's in-page client.
 */

import { generateFilename, getExtensionFromUrl } from '../utils/filename.js';
import { extractTweetMetadata, extractImageUrls, hasVideoMedia, hasAnyMedia, getVideoContainers } from './extractor.js';
import { downloadWithSystemPath } from '../utils/file-saver.js';
import {
  extractVideoFromReactNode,
  scanPageScriptTags,
  fetchTweetFromInternalTwitterApi,
  resolveAllTweetMedia,
  extractAllVideosFromTweet
} from './interceptor.js';
import { selectHighestBitrateVideo } from '../utils/video.js';

export const ICONS = {
  DOWNLOAD: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5a.75.75 0 0 1 .75.75v11.69l3.22-3.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 1 1 1.06-1.06l3.22 3.22V3.25a.75.75 0 0 1 .75-.75Zm-7.5 16a.75.75 0 0 1 .75-.75h13.5a.75.75 0 0 1 0 1.5H5.25a.75.75 0 0 1-.75-.75Z"/></svg>`,
  SPINNER: `<svg class="tmd-spinner" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="35" stroke-dashoffset="10"/></svg>`,
  SUCCESS: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.55 18a.75.75 0 0 1-.53-.22l-4.5-4.5a.75.75 0 1 1 1.06-1.06l3.97 3.97 9.47-9.47a.75.75 0 1 1 1.06 1.06l-10 10a.75.75 0 0 1-.53.22Z"/></svg>`,
  ERROR: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 14a1.25 1.25 0 1 1 1.25-1.25A1.25 1.25 0 0 1 12 16Zm1-5a1 1 0 0 1-2 0V7a1 1 0 0 1 2 0Z"/></svg>`
};

/**
 * Handles visual state transition for a button
 * @param {HTMLButtonElement} btn
 * @param {boolean} success
 */
function setButtonState(btn, success) {
  btn.classList.remove('tmd-loading');
  if (success) {
    btn.classList.add('tmd-success');
    btn.innerHTML = ICONS.SUCCESS;
    setTimeout(() => {
      btn.classList.remove('tmd-success');
      btn.innerHTML = ICONS.DOWNLOAD;
    }, 2000);
  } else {
    btn.classList.add('tmd-error');
    btn.innerHTML = ICONS.ERROR;
    setTimeout(() => {
      btn.classList.remove('tmd-error');
      btn.innerHTML = ICONS.DOWNLOAD;
    }, 2500);
  }
}

/**
 * Resolves the video MP4 URL locally without contacting third-party services.
 * @param {Element} tweetElement
 * @param {string} tweetId
 * @returns {Promise<string|null>}
 */
async function resolveLocalVideoUrl(tweetElement, tweetId) {
  const allMedia = await resolveAllTweetMedia(tweetElement, tweetId);
  const videoItem = allMedia.find((m) => m.type === 'video');
  return videoItem?.url || null;
}

/**
 * Injects hover overlay download buttons onto individual image & video media containers
 * @param {Element} tweetElement
 */
export function injectMediaOverlayButtons(tweetElement) {
  if (!tweetElement) return;

  const { caption, author, tweetId } = extractTweetMetadata(tweetElement);

  // 1. Photos
  const images = extractImageUrls(tweetElement);
  images.forEach((imgObj, idx) => {
    const imgEl = imgObj.element;
    if (!imgEl) return;

    const container = imgEl.closest('[data-testid="tweetPhoto"]') || imgEl.parentElement;
    if (!container || container.querySelector('.tmd-overlay-btn')) {
      return;
    }

    const computedPos = window.getComputedStyle ? window.getComputedStyle(container).position : '';
    if (computedPos === 'static') {
      container.style.position = 'relative';
    }

    const overlayBtn = document.createElement('button');
    overlayBtn.type = 'button';
    overlayBtn.className = 'tmd-overlay-btn';
    overlayBtn.title = 'Download this image';
    overlayBtn.setAttribute('aria-label', overlayBtn.title);
    overlayBtn.innerHTML = ICONS.DOWNLOAD;

    overlayBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (overlayBtn.classList.contains('tmd-loading')) return;

      overlayBtn.classList.remove('tmd-success', 'tmd-error');
      overlayBtn.classList.add('tmd-loading');
      overlayBtn.innerHTML = ICONS.SPINNER;

      const ext = getExtensionFromUrl(imgObj.url, 'jpg');
      const filename = generateFilename({
        caption,
        author,
        tweetId,
        index: idx + 1,
        totalAssets: images.length,
        extension: ext
      });

      const onProgress = (ratio) => {
        const percent = Math.min(100, Math.round(ratio * 100));
        overlayBtn.innerHTML = `<span class="tmd-progress-text">${percent}%</span>`;
      };

      const res = await downloadWithSystemPath({ url: imgObj.url, filename, onProgress });
      setButtonState(overlayBtn, res.success);
    });

    container.appendChild(overlayBtn);
  });

  // 2. Individual Video Containers (handles 1 to 4 videos in a grid)
  const videoContainers = getVideoContainers(tweetElement);

  videoContainers.forEach((container, vIdx) => {
    if (container.querySelector('.tmd-overlay-btn')) {
      return;
    }

    const computedPos = window.getComputedStyle ? window.getComputedStyle(container).position : '';
    if (computedPos === 'static') {
      container.style.position = 'relative';
    }

    const overlayBtn = document.createElement('button');
    overlayBtn.type = 'button';
    overlayBtn.className = 'tmd-overlay-btn';
    overlayBtn.title = 'Download this video';
    overlayBtn.setAttribute('aria-label', overlayBtn.title);
    overlayBtn.innerHTML = ICONS.DOWNLOAD;

    overlayBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (overlayBtn.classList.contains('tmd-loading')) return;

      overlayBtn.classList.remove('tmd-success', 'tmd-error');
      overlayBtn.classList.add('tmd-loading');
      overlayBtn.innerHTML = ICONS.SPINNER;

      const onProgress = (ratio) => {
        const percent = Math.min(100, Math.round(ratio * 100));
        overlayBtn.innerHTML = `<span class="tmd-progress-text">${percent}%</span>`;
      };

      // Resolve all media for the tweet
      const allMedia = await resolveAllTweetMedia(tweetElement, tweetId);
      const vids = allMedia.filter((m) => m.type === 'video');

      // 1. Direct local container check if single video
      let videoUrl = null;
      if (videoContainers.length === 1) {
        const localVariants = extractVideoFromReactNode(container);
        videoUrl = selectHighestBitrateVideo(localVariants);
      }

      // 2. For multi-video grids or fallback, map container index to video index
      if (!videoUrl) {
        videoUrl = vids[vIdx]?.url || vids[0]?.url;
      }

      if (!videoUrl) {
        setButtonState(overlayBtn, false);
        return;
      }

      const filename = generateFilename({
        caption,
        author,
        tweetId,
        index: vIdx + 1,
        totalAssets: videoContainers.length,
        extension: 'mp4'
      });

      const res = await downloadWithSystemPath({ url: videoUrl, filename, onProgress });
      setButtonState(overlayBtn, res.success);
    });

    container.appendChild(overlayBtn);
  });
}


/**
 * Injects the Action Bar download button into a tweet element
 * @param {Element} tweetElement
 */
export function injectActionBarButton(tweetElement) {
  if (!tweetElement || tweetElement.querySelector('.tmd-action-btn-wrapper')) {
    return;
  }

  if (!hasAnyMedia(tweetElement)) {
    return;
  }

  const actionBar = tweetElement.querySelector('div[role="group"]');
  if (!actionBar) {
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'tmd-action-btn-wrapper';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tmd-action-btn';
  btn.title = 'Download media';
  btn.setAttribute('aria-label', btn.title);
  btn.innerHTML = ICONS.DOWNLOAD;

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (btn.classList.contains('tmd-loading')) {
      return;
    }

    btn.classList.remove('tmd-success', 'tmd-error');
    btn.classList.add('tmd-loading');
    btn.innerHTML = ICONS.SPINNER;

    try {
      const { caption, author, tweetId } = extractTweetMetadata(tweetElement);
      const mediaItems = await resolveAllTweetMedia(tweetElement, tweetId);

      if (mediaItems.length === 0) {
        console.warn('[Twitter Media Downloader] No media resolved for tweet:', tweetId);
        setButtonState(btn, false);
        return;
      }

      const totalAssets = mediaItems.length;
      let allSuccess = true;

      for (let i = 0; i < totalAssets; i++) {
        const item = mediaItems[i];
        const defaultExt = item.type === 'video' ? 'mp4' : 'jpg';
        const ext = getExtensionFromUrl(item.url, defaultExt);

        const filename = generateFilename({
          caption,
          author,
          tweetId,
          index: i + 1,
          totalAssets,
          extension: ext
        });

        const onItemProgress = (ratio) => {
          const overall = Math.min(100, Math.round(((i + ratio) / totalAssets) * 100));
          btn.innerHTML = `<span class="tmd-progress-text">${overall}%</span>`;
        };

        const res = await downloadWithSystemPath({ url: item.url, filename, onProgress: onItemProgress });
        if (!res.success) {
          allSuccess = false;
        }

        if (i < totalAssets - 1) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }

      setButtonState(btn, allSuccess);
    } catch (err) {
      console.error('[Twitter Media Downloader] Error during download execution:', err);
      setButtonState(btn, false);
    }
  });

  wrapper.appendChild(btn);
  actionBar.appendChild(wrapper);
}

/**
 * Scans the DOM for tweets and processes them
 * @param {Document|Element} root
 */
export function scanAndInjectTweets(root = document) {
  const tweets = root.querySelectorAll('article[data-testid="tweet"]');
  for (const tweet of tweets) {
    injectActionBarButton(tweet);
    injectMediaOverlayButtons(tweet);
  }
}

/**
 * Initializes the MutationObserver to handle Twitter's infinite scroll and client-side routing
 */
export function initObserver() {
  scanAndInjectTweets();

  let timeoutId = null;
  const observer = new MutationObserver(() => {
    if (timeoutId) return;
    timeoutId = setTimeout(() => {
      timeoutId = null;
      scanAndInjectTweets();
    }, 150);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  return observer;
}

// Auto-run when in browser environment
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initObserver());
  } else {
    initObserver();
  }
}
