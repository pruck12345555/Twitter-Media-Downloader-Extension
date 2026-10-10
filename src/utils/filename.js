/**
 * Twitter Media Downloader - Filename & Caption Sanitization Utility
 */

const MAX_CAPTION_LENGTH = 100;

// Reserved Windows file names
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Strips URLs, illegal characters, normalizes whitespace, and truncates text.
 * @param {string} rawCaption - Raw tweet text
 * @param {number} [maxLength=100] - Maximum allowed caption length
 * @returns {string} Sanitized string safe for filesystem filenames
 */
export function sanitizeCaption(rawCaption, maxLength = MAX_CAPTION_LENGTH) {
  if (!rawCaption || typeof rawCaption !== 'string') {
    return '';
  }

  let text = rawCaption;

  // 1. Strip URLs (standard http/https and Twitter short links t.co)
  text = text.replace(/https?:\/\/\S+/gi, '');
  text = text.replace(/t\.co\/\S+/gi, '');

  // 2. Normalize newlines, carriage returns, tabs, and non-breaking spaces into single spaces
  text = text.replace(/[\r\n\t\u00A0\u2000-\u200B]+/g, ' ');

  // 3. Remove filesystem forbidden characters: \ / : * ? " < > |
  // Also remove control characters (0x00 - 0x1F)
  text = text.replace(/[\/\\:*?"<>|\x00-\x1F]/g, '');

  // 4. Collapse multiple spaces into one
  text = text.replace(/\s+/g, ' ').trim();

  // 5. Truncate to maxLength without cutting mid-word if possible
  if (text.length > maxLength) {
    const truncated = text.slice(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    // Only break at word boundary if the word break is reasonably close to the end
    if (lastSpace > maxLength * 0.7) {
      text = truncated.slice(0, lastSpace).trim();
    } else {
      text = truncated.trim();
    }
  }

  // 6. Windows files cannot end in periods or spaces
  text = text.replace(/[.\s]+$/g, '');

  // 7. If the name matches a reserved Windows device name, append an underscore
  if (RESERVED_NAMES.test(text)) {
    text = `${text}_`;
  }

  return text;
}

/**
 * Normalizes author handle, stripping leading @ if present.
 * @param {string} author
 * @returns {string}
 */
export function normalizeAuthor(author) {
  if (!author || typeof author !== 'string') return '';
  return author.replace(/^@+/, '').trim();
}

/**
 * Derives a clean file extension from a URL or mime-type
 * @param {string} url - Media URL
 * @param {string} [defaultExt='jpg'] - Default extension if none found
 * @returns {string} e.g. 'jpg', 'png', 'mp4'
 */
export function getExtensionFromUrl(url, defaultExt = 'jpg') {
  if (!url || typeof url !== 'string') return defaultExt;

  try {
    const parsed = new URL(url);

    // Twitter image format query param (e.g. ?format=jpg or &format=png)
    const formatParam = parsed.searchParams.get('format');
    if (formatParam) {
      return formatParam.toLowerCase();
    }

    // Path extension (e.g. /video.mp4)
    const match = parsed.pathname.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
    if (match && match[1]) {
      return match[1].toLowerCase();
    }
  } catch {
    // If not a full URL, fallback regex
    const match = url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
    if (match && match[1]) {
      return match[1].toLowerCase();
    }
  }

  return defaultExt;
}

/**
 * Generates an OS-safe, human-readable filename for a media asset.
 *
 * @param {Object} options
 * @param {string} [options.caption] - Tweet caption
 * @param {string} [options.author] - Tweet author username
 * @param {string|number} [options.tweetId] - Unique Tweet ID
 * @param {number} [options.index=1] - 1-based index of this media in the tweet
 * @param {number} [options.totalAssets=1] - Total media items in the tweet
 * @param {string} [options.extension='jpg'] - File extension (without dot)
 * @returns {string} Final filename e.g. "Cat_playing_1.jpg" or "@jack_12345.mp4"
 */
export function generateFilename({
  caption = '',
  author = '',
  tweetId = '',
  index = 1,
  totalAssets = 1,
  extension = 'jpg'
} = {}) {
  const sanitized = sanitizeCaption(caption);
  const cleanExt = extension.replace(/^\.+/, '').toLowerCase() || 'jpg';

  let baseName = sanitized;

  // Fallback if no caption text or caption was only URLs/illegal characters
  if (!baseName) {
    const cleanAuthor = normalizeAuthor(author);
    if (cleanAuthor && tweetId) {
      baseName = `@${cleanAuthor}_${tweetId}`;
    } else if (cleanAuthor) {
      baseName = `@${cleanAuthor}_media`;
    } else if (tweetId) {
      baseName = `tweet_${tweetId}`;
    } else {
      baseName = `twitter_media_${Date.now()}`;
    }
  }

  // Multi-asset suffix only if totalAssets > 1
  if (totalAssets > 1) {
    baseName = `${baseName}_${index}`;
  }

  return `${baseName}.${cleanExt}`;
}
