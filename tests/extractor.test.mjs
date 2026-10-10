import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toOriginalImageUrl,
  extractTweetMetadata,
  extractImageUrls,
  getMediaCanonicalKey
} from '../src/content/extractor.js';

test('toOriginalImageUrl - converts modern format to name=orig', () => {
  const input = 'https://pbs.twimg.com/media/Gabcdef?format=jpg&name=900x900';
  const expected = 'https://pbs.twimg.com/media/Gabcdef?format=jpg&name=orig';
  assert.equal(toOriginalImageUrl(input), expected);
});

test('toOriginalImageUrl - preserves png format with name=orig', () => {
  const input = 'https://pbs.twimg.com/media/Hxyz123?format=png&name=small';
  const expected = 'https://pbs.twimg.com/media/Hxyz123?format=png&name=orig';
  assert.equal(toOriginalImageUrl(input), expected);
});

test('toOriginalImageUrl - converts legacy colon syntax to name=orig', () => {
  const input = 'https://pbs.twimg.com/media/Legacy123.jpg:large';
  const expected = 'https://pbs.twimg.com/media/Legacy123?format=jpg&name=orig';
  assert.equal(toOriginalImageUrl(input), expected);
});

test('toOriginalImageUrl - leaves non-Twitter URLs untouched', () => {
  const input = 'https://example.com/photo.jpg';
  assert.equal(toOriginalImageUrl(input), input);
});

// Lightweight DOM mock for unit testing Twitter DOM structures
class MockElement {
  constructor(tagName, attributes = {}, textContent = '') {
    this.tagName = tagName.toUpperCase();
    this.attributes = attributes;
    this.textContent = textContent;
    this.children = [];
    this.parentNode = null;
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  closest(selector) {
    let curr = this.parentNode;
    while (curr) {
      if (curr.matches && curr.matches(selector)) {
        return curr;
      }
      curr = curr.parentNode;
    }
    return null;
  }

  matches(selector) {
    if (selector.includes('[data-testid="quoteTweet"]')) {
      return this.attributes['data-testid'] === 'quoteTweet';
    }
    if (selector.includes('[data-testid="Tweet-User-Avatar"]')) {
      return this.attributes['data-testid'] === 'Tweet-User-Avatar';
    }
    return false;
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector) {
    const matches = [];

    const traverse = (node) => {
      for (const child of node.children) {
        let isMatch = false;

        if (selector === 'div[data-testid="tweetText"]' && child.attributes['data-testid'] === 'tweetText') {
          isMatch = true;
        } else if (selector === 'div[data-testid="User-Name"]' && child.attributes['data-testid'] === 'User-Name') {
          isMatch = true;
        } else if (selector === 'a[href*="/status/"]' && child.attributes['href'] && child.attributes['href'].includes('/status/')) {
          isMatch = true;
        } else if (selector === 'img[src*="pbs.twimg.com/media/"]' && child.tagName === 'IMG' && child.attributes['src'] && child.attributes['src'].includes('pbs.twimg.com/media/')) {
          isMatch = true;
        }

        if (isMatch) {
          matches.push(child);
        }
        traverse(child);
      }
    };

    traverse(this);
    return matches;
  }
}

test('extractTweetMetadata - parses caption, author, and tweetId correctly', () => {
  const tweet = new MockElement('article', { 'data-testid': 'tweet' });

  // Author
  const userDiv = new MockElement('div', { 'data-testid': 'User-Name' }, 'John Doe @johndoe · 2h');
  tweet.appendChild(userDiv);

  // Status Link
  const link = new MockElement('a', { 'href': '/johndoe/status/1234567890123456789' });
  tweet.appendChild(link);

  // Text
  const textDiv = new MockElement('div', { 'data-testid': 'tweetText' }, 'Look at this beautiful view!');
  tweet.appendChild(textDiv);

  const meta = extractTweetMetadata(tweet);
  assert.equal(meta.caption, 'Look at this beautiful view!');
  assert.equal(meta.author, 'johndoe');
  assert.equal(meta.tweetId, '1234567890123456789');
});

test('extractImageUrls - extracts direct images and ignores quoted tweet images', () => {
  const tweet = new MockElement('article', { 'data-testid': 'tweet' });

  // Direct image
  const directImg = new MockElement('img', {
    src: 'https://pbs.twimg.com/media/DirectPic?format=jpg&name=medium'
  });
  tweet.appendChild(directImg);

  // Quoted tweet container
  const quoteTweet = new MockElement('div', { 'data-testid': 'quoteTweet' });
  const quotedImg = new MockElement('img', {
    src: 'https://pbs.twimg.com/media/QuotedPic?format=jpg&name=medium'
  });
  quoteTweet.appendChild(quotedImg);
  tweet.appendChild(quoteTweet);

  const images = extractImageUrls(tweet);

  // Only direct image should be returned
  assert.equal(images.length, 1);
  assert.equal(images[0].url, 'https://pbs.twimg.com/media/DirectPic?format=jpg&name=orig');
});

test('getMediaCanonicalKey - extracts identical canonical key for different resolutions and formats', () => {
  const raw = 'https://pbs.twimg.com/media/Gabcdef.jpg';
  const orig = 'https://pbs.twimg.com/media/Gabcdef?format=jpg&name=orig';
  const med = 'https://pbs.twimg.com/media/Gabcdef?format=jpg&name=medium';

  assert.equal(getMediaCanonicalKey(raw), 'img_Gabcdef');
  assert.equal(getMediaCanonicalKey(orig), 'img_Gabcdef');
  assert.equal(getMediaCanonicalKey(med), 'img_Gabcdef');

  const extVid = 'https://video.twimg.com/ext_tw_video/123456789/pu/vid/avc1/720x1280/xyz.mp4';
  const ampVid = 'https://video.twimg.com/amplify_video/987654321/vid/avc1/1080x1920/abc.mp4';

  assert.equal(getMediaCanonicalKey(extVid), 'vid_123456789');
  assert.equal(getMediaCanonicalKey(ampVid), 'vid_987654321');
});
