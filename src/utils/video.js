/**
 * Twitter Media Downloader - Video Resolution & Variant Selector
 */

import { toOriginalImageUrl } from '../content/extractor.js';

/**
 * Computes Twitter's syndication token for a tweet ID.
 * @param {string|number} tweetId
 * @returns {string}
 */
export function getSyndicationToken(tweetId) {
  try {
    const id = BigInt(tweetId);
    // Twitter's syndication token algorithm
    const num = (Number(id) / 1e15) * Math.PI;
    return num.toString(36).replace(/(0+|\.)/g, '');
  } catch {
    return '1';
  }
}

/**
 * Selects the highest bitrate MP4 video variant from an array of Twitter video variants.
 *
 * @param {Array<{ content_type: string, bitrate?: number, url: string }>} variants
 * @returns {string|null} URL of the best quality MP4
 */
export function selectHighestBitrateVideo(variants) {
  if (!Array.isArray(variants) || variants.length === 0) {
    return null;
  }

  // Filter for MP4 videos with valid URLs
  const mp4Variants = variants.filter(
    (v) => v && v.content_type === 'video/mp4' && typeof v.url === 'string' && v.url.length > 0
  );

  if (mp4Variants.length === 0) {
    // Fallback: any variant with a URL
    const fallback = variants.find((v) => v && typeof v.url === 'string');
    return fallback ? fallback.url : null;
  }

  // Sort descending by bitrate
  mp4Variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  return mp4Variants[0].url;
}

/**
 * Parses media items from Twitter syndication API tweet-result payload.
 *
 * @param {Object} tweetData - JSON object from syndication endpoint
 * @returns {Array<{ type: 'image'|'video', url: string }>}
 */
export function parseMediaFromSyndication(tweetData) {
  if (!tweetData) return [];

  const mediaList =
    tweetData.mediaDetails ||
    (tweetData.extended_entities && tweetData.extended_entities.media) ||
    (tweetData.entities && tweetData.entities.media) ||
    [];

  const results = [];

  for (const media of mediaList) {
    if (!media) continue;

    if (media.type === 'video' || media.type === 'animated_gif') {
      const variants = media.video_info?.variants || [];
      const bestVideoUrl = selectHighestBitrateVideo(variants);
      if (bestVideoUrl) {
        results.push({
          type: 'video',
          url: bestVideoUrl
        });
      }
    } else if (media.type === 'photo') {
      const imgUrl = media.media_url_https || media.url;
      if (imgUrl) {
        results.push({
          type: 'image',
          url: toOriginalImageUrl(imgUrl)
        });
      }
    }
  }

  return results;
}
