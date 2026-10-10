/**
 * Twitter Media Downloader - Tweet & Media DOM Extractor
 */

/**
 * Transforms a Twitter image URL into its highest available original resolution (name=orig).
 *
 * @param {string} rawUrl
 * @returns {string} Original resolution image URL
 */
export function toOriginalImageUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';

  try {
    const url = new URL(rawUrl);

    if (!url.hostname.includes('twimg.com')) {
      return rawUrl;
    }

    if (url.searchParams.has('format')) {
      url.searchParams.set('name', 'orig');
      return url.toString();
    }

    const pathname = url.pathname;
    const match = pathname.match(/(.*)\.([a-zA-Z0-9]+)(?::[a-zA-Z0-9]+)?$/);
    if (match) {
      const basePath = match[1];
      const ext = match[2];
      url.pathname = basePath;
      url.searchParams.set('format', ext);
      url.searchParams.set('name', 'orig');
      return url.toString();
    }

    url.searchParams.set('name', 'orig');
    return url.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Extracts caption text, author handle, and tweet ID from a tweet article DOM element.
 *
 * @param {Element} tweetElement - The <article data-testid="tweet"> element
 * @returns {{ caption: string, author: string, tweetId: string }}
 */
export function extractTweetMetadata(tweetElement) {
  if (!tweetElement) {
    return { caption: '', author: '', tweetId: '' };
  }

  // 1. Caption text (exclude text inside quote tweets)
  let caption = '';
  const textContainer = tweetElement.querySelector('div[data-testid="tweetText"]');
  if (textContainer) {
    const parentQuote = textContainer.closest('[data-testid="quoteTweet"], [data-testid="quoteTweetWrapper"]');
    if (!parentQuote) {
      caption = textContainer.textContent || '';
    }
  }

  // 2. Author handle
  let author = '';
  const userNameElem = tweetElement.querySelector('div[data-testid="User-Name"]');
  if (userNameElem) {
    const handleMatch = userNameElem.textContent.match(/@([a-zA-Z0-9_]{1,15})/);
    if (handleMatch) {
      author = handleMatch[1];
    }
  }

  // 3. Tweet ID from status links or current URL pathname
  let tweetId = '';
  const links = tweetElement.querySelectorAll('a[href*="/status/"]');
  for (const link of links) {
    // Avoid quote tweet links
    const quoteContainer = link.closest('[data-testid="quoteTweet"], [data-testid="quoteTweetWrapper"]');
    if (quoteContainer && quoteContainer !== tweetElement) {
      continue;
    }

    const href = link.getAttribute('href') || '';
    const match = href.match(/\/status\/(\d+)/);
    if (match) {
      tweetId = match[1];
      break;
    }
  }

  // Fallback to page URL if currently viewing the tweet permalink
  if (!tweetId && typeof window !== 'undefined' && window.location) {
    const pageMatch = window.location.pathname.match(/\/status\/(\d+)/);
    if (pageMatch) {
      tweetId = pageMatch[1];
    }
  }

  return { caption, author, tweetId };
}

/**
 * Finds all direct image URLs attached to the tweet, excluding any images inside quoted tweets.
 *
 * @param {Element} tweetElement - The <article data-testid="tweet"> element
 * @returns {Array<{ url: string, element: Element }>}
 */
export function extractImageUrls(tweetElement) {
  if (!tweetElement) return [];

  const imgs = tweetElement.querySelectorAll('img[src*="pbs.twimg.com/media/"]');
  const results = [];
  const seenUrls = new Set();

  for (const img of imgs) {
    const quoteContainer = img.closest('[data-testid="quoteTweet"], [data-testid="quoteTweetWrapper"]');
    if (quoteContainer && quoteContainer !== tweetElement) {
      continue;
    }

    if (img.closest('[data-testid="Tweet-User-Avatar"]')) {
      continue;
    }

    const src = img.getAttribute('src');
    if (!src) continue;

    const origUrl = toOriginalImageUrl(src);
    if (origUrl && !seenUrls.has(origUrl)) {
      seenUrls.add(origUrl);
      results.push({
        url: origUrl,
        element: img
      });
    }
  }

  return results;
}

/**
 * Checks whether the tweet element contains direct video or GIF media (excluding quote tweets).
 *
 * @param {Element} tweetElement
 * @returns {boolean}
 */
export function hasVideoMedia(tweetElement) {
  if (!tweetElement) return false;

  const videoPlayers = tweetElement.querySelectorAll(
    '[data-testid="videoPlayer"], [data-testid="videoComponent"], video'
  );

  for (const el of videoPlayers) {
    const quoteContainer = el.closest('[data-testid="quoteTweet"], [data-testid="quoteTweetWrapper"]');
    if (!quoteContainer || quoteContainer === tweetElement) {
      return true;
    }
  }

  return false;
}

/**
 * Returns true if tweet contains any media (images, video, or GIF).
 *
 * @param {Element} tweetElement
 * @returns {boolean}
 */
export function hasAnyMedia(tweetElement) {
  if (!tweetElement) return false;
  return extractImageUrls(tweetElement).length > 0 || hasVideoMedia(tweetElement);
}

/**
 * Returns distinct video container elements for a tweet (excluding quote tweets and nested child containers).
 * Accurately isolates 1 to 4 video slots in multi-video posts.
 *
 * @param {Element} tweetElement
 * @returns {Array<Element>}
 */
export function getVideoContainers(tweetElement) {
  if (!tweetElement || !tweetElement.querySelectorAll) return [];

  const candidates = Array.from(
    tweetElement.querySelectorAll('[data-testid="videoPlayer"], [data-testid="videoComponent"]')
  ).filter((el) => {
    const quote = el.closest?.('[data-testid="quoteTweet"], [data-testid="quoteTweetWrapper"]');
    return !quote || quote === tweetElement;
  });

  const isContained = (parent, child) => {
    if (typeof parent.contains === 'function') {
      return parent.contains(child);
    }
    let curr = child.parentNode;
    while (curr) {
      if (curr === parent) return true;
      curr = curr.parentNode;
    }
    return false;
  };

  if (candidates.length === 0) {
    const rawVideos = Array.from(tweetElement.querySelectorAll('video')).filter((el) => {
      const quote = el.closest?.('[data-testid="quoteTweet"], [data-testid="quoteTweetWrapper"]');
      return !quote || quote === tweetElement;
    });
    return rawVideos.filter((el) => !rawVideos.some((other) => other !== el && isContained(other, el)));
  }

  // Filter out any candidate that is contained inside another candidate (keep only outermost containers)
  return candidates.filter((el) => {
    return !candidates.some((other) => other !== el && isContained(other, el));
  });
}

/**
 * Returns a canonical key for a Twitter media URL to prevent duplicate downloads
 * of the same asset across different resolutions or formats.
 *
 * @param {string} url
 * @returns {string}
 */
export function getMediaCanonicalKey(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('twimg.com')) {
      // Photo media ID: /media/<ID>
      const imgMatch = parsed.pathname.match(/\/media\/([a-zA-Z0-9_-]+)/);
      if (imgMatch) {
        return `img_${imgMatch[1]}`;
      }
      // Video ID: /ext_tw_video/<ID>/... or /amplify_video/<ID>/... or /<ID>.mp4
      const vidMatch = parsed.pathname.match(/(?:video|amplify_video)\/(\d+)/);
      if (vidMatch) {
        return `vid_${vidMatch[1]}`;
      }
      const mp4Match = parsed.pathname.match(/\/([a-zA-Z0-9_-]+)\.mp4/);
      if (mp4Match) {
        return `vid_${mp4Match[1]}`;
      }
    }
  } catch {}
  return url;
}


