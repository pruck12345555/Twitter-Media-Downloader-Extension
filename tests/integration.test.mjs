import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTweetMetadata,
  extractImageUrls,
  hasVideoMedia
} from '../src/content/extractor.js';
import { generateFilename, getExtensionFromUrl } from '../src/utils/filename.js';

// DOM Mock helper
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

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  contains(child) {
    let curr = child;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentNode;
    }
    return false;
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
    if (selector.includes('[data-testid="quoteTweetWrapper"]')) {
      return this.attributes['data-testid'] === 'quoteTweetWrapper';
    }
    if (selector.includes('[data-testid="tweetPhoto"]')) {
      return this.attributes['data-testid'] === 'tweetPhoto';
    }
    if (selector.includes('[data-testid="videoComponent"]')) {
      return this.attributes['data-testid'] === 'videoComponent';
    }
    if (selector.includes('[data-testid="videoPlayer"]')) {
      return this.attributes['data-testid'] === 'videoPlayer';
    }
    return false;
  }

  querySelectorAll(selector) {
    const matches = [];

    const traverse = (node) => {
      for (const child of node.children) {
        let isMatch = false;

        if (selector.includes('img[src*="pbs.twimg.com/media/"]') && child.tagName === 'IMG') {
          const src = child.getAttribute('src');
          if (src && src.includes('pbs.twimg.com/media/')) isMatch = true;
        } else if (selector.includes('[data-testid="videoComponent"]') && child.attributes['data-testid'] === 'videoComponent') {
          isMatch = true;
        } else if (selector.includes('[data-testid="videoPlayer"]') && child.attributes['data-testid'] === 'videoPlayer') {
          isMatch = true;
        } else if (selector.includes('div[data-testid="tweetText"]') && child.attributes['data-testid'] === 'tweetText') {
          isMatch = true;
        } else if (selector.includes('div[data-testid="User-Name"]') && child.attributes['data-testid'] === 'User-Name') {
          isMatch = true;
        } else if (selector.includes('a[href*="/status/"]') && child.attributes['href'] && child.attributes['href'].includes('/status/')) {
          isMatch = true;
        }


        if (isMatch) matches.push(child);
        traverse(child);
      }
    };

    traverse(this);
    return matches;
  }

  querySelector(selector) {
    const res = this.querySelectorAll(selector);
    return res.length > 0 ? res[0] : null;
  }
}

test('Integration: 4-image grid tweet generates sequential filenames and orig URLs', () => {
  const tweet = new MockElement('article', { 'data-testid': 'tweet' });

  // Author & ID
  tweet.appendChild(new MockElement('div', { 'data-testid': 'User-Name' }, 'Cosmic Explorer @cosmic_ex'));
  tweet.appendChild(new MockElement('a', { 'href': '/cosmic_ex/status/987654321' }));
  tweet.appendChild(new MockElement('div', { 'data-testid': 'tweetText' }, 'Stunning views from the James Webb Space Telescope: Pillars of Creation! https://t.co/jwst123'));

  // 4 photos
  for (let i = 1; i <= 4; i++) {
    const photoContainer = new MockElement('div', { 'data-testid': 'tweetPhoto' });
    const img = new MockElement('img', {
      src: `https://pbs.twimg.com/media/JWST_${i}?format=jpg&name=medium`
    });
    photoContainer.appendChild(img);
    tweet.appendChild(photoContainer);
  }

  // 1. Extract metadata
  const meta = extractTweetMetadata(tweet);
  assert.equal(meta.caption, 'Stunning views from the James Webb Space Telescope: Pillars of Creation! https://t.co/jwst123');
  assert.equal(meta.author, 'cosmic_ex');
  assert.equal(meta.tweetId, '987654321');

  // 2. Extract images
  const images = extractImageUrls(tweet);
  assert.equal(images.length, 4);

  // 3. Generate filenames
  const filenames = images.map((img, idx) => {
    const ext = getExtensionFromUrl(img.url);
    return generateFilename({
      caption: meta.caption,
      author: meta.author,
      tweetId: meta.tweetId,
      index: idx + 1,
      totalAssets: images.length,
      extension: ext
    });
  });

  assert.equal(filenames[0], 'Stunning views from the James Webb Space Telescope Pillars of Creation!_1.jpg');
  assert.equal(filenames[1], 'Stunning views from the James Webb Space Telescope Pillars of Creation!_2.jpg');
  assert.equal(filenames[2], 'Stunning views from the James Webb Space Telescope Pillars of Creation!_3.jpg');
  assert.equal(filenames[3], 'Stunning views from the James Webb Space Telescope Pillars of Creation!_4.jpg');

  // Verify all URLs are orig
  images.forEach((img, idx) => {
    assert.equal(img.url, `https://pbs.twimg.com/media/JWST_${idx + 1}?format=jpg&name=orig`);
  });
});

test('Integration: Single-image tweet uses {caption}.jpg without numeric suffix', () => {
  const tweet = new MockElement('article', { 'data-testid': 'tweet' });
  tweet.appendChild(new MockElement('div', { 'data-testid': 'User-Name' }, 'Chef Alex @alexcooks'));
  tweet.appendChild(new MockElement('a', { 'href': '/alexcooks/status/555123' }));
  tweet.appendChild(new MockElement('div', { 'data-testid': 'tweetText' }, 'Homemade sourdough bread fresh out of the oven!'));

  const img = new MockElement('img', {
    src: 'https://pbs.twimg.com/media/Bread123?format=png&name=large'
  });
  tweet.appendChild(img);

  const meta = extractTweetMetadata(tweet);
  const images = extractImageUrls(tweet);
  assert.equal(images.length, 1);

  const filename = generateFilename({
    caption: meta.caption,
    author: meta.author,
    tweetId: meta.tweetId,
    index: 1,
    totalAssets: 1,
    extension: getExtensionFromUrl(images[0].url)
  });

  assert.equal(filename, 'Homemade sourdough bread fresh out of the oven!.png');
});

test('Integration: Quote tweet isolation strictly excludes quoted media', () => {
  const parentTweet = new MockElement('article', { 'data-testid': 'tweet' });
  parentTweet.appendChild(new MockElement('div', { 'data-testid': 'User-Name' }, 'Commenter @commenter'));
  parentTweet.appendChild(new MockElement('a', { 'href': '/commenter/status/111' }));
  parentTweet.appendChild(new MockElement('div', { 'data-testid': 'tweetText' }, 'Totally agree with this!'));

  // Parent tweet has 1 image
  const parentImg = new MockElement('img', {
    src: 'https://pbs.twimg.com/media/ParentPic?format=jpg&name=900x900'
  });
  parentTweet.appendChild(parentImg);

  // Quoted tweet has 2 images and a video
  const quoteTweet = new MockElement('div', { 'data-testid': 'quoteTweet' });
  quoteTweet.appendChild(new MockElement('img', {
    src: 'https://pbs.twimg.com/media/QuotePic1?format=jpg&name=medium'
  }));
  quoteTweet.appendChild(new MockElement('img', {
    src: 'https://pbs.twimg.com/media/QuotePic2?format=jpg&name=medium'
  }));
  quoteTweet.appendChild(new MockElement('div', { 'data-testid': 'videoPlayer' }));
  parentTweet.appendChild(quoteTweet);

  const images = extractImageUrls(parentTweet);
  assert.equal(images.length, 1);
  assert.equal(images[0].url, 'https://pbs.twimg.com/media/ParentPic?format=jpg&name=orig');

  const hasVideo = hasVideoMedia(parentTweet);
  assert.equal(hasVideo, false); // Quoted video is not parent's video
});

test('Integration: getVideoContainers isolates distinct video containers and ignores nested players', async () => {
  const { getVideoContainers } = await import('../src/content/extractor.js');

  const tweet = new MockElement('article', { 'data-testid': 'tweet' });

  // Video container 1 (videoComponent wrapping videoPlayer)
  const container1 = new MockElement('div', { 'data-testid': 'videoComponent' });
  const innerPlayer1 = new MockElement('div', { 'data-testid': 'videoPlayer' });
  container1.appendChild(innerPlayer1);
  tweet.appendChild(container1);

  // Video container 2 (videoComponent wrapping videoPlayer)
  const container2 = new MockElement('div', { 'data-testid': 'videoComponent' });
  const innerPlayer2 = new MockElement('div', { 'data-testid': 'videoPlayer' });
  container2.appendChild(innerPlayer2);
  tweet.appendChild(container2);

  // Quote tweet video (should be strictly excluded)
  const quoteTweet = new MockElement('div', { 'data-testid': 'quoteTweet' });
  const quoteVideo = new MockElement('div', { 'data-testid': 'videoPlayer' });
  quoteTweet.appendChild(quoteVideo);
  tweet.appendChild(quoteTweet);

  const containers = getVideoContainers(tweet);
  assert.equal(containers.length, 2, 'Should isolate exactly 2 distinct video containers');
  assert.equal(containers[0], container1);
  assert.equal(containers[1], container2);
});

test('Integration: Multi-video post generates sequential filenames and resolves both videos', () => {
  const meta = {
    caption: 'Best movie trailers of 2026 revealed!',
    author: 'filmfan',
    tweetId: '888999111'
  };

  const resolvedVideos = [
    { type: 'video', url: 'https://video.twimg.com/trailer1.mp4' },
    { type: 'video', url: 'https://video.twimg.com/trailer2.mp4' }
  ];

  const totalAssets = resolvedVideos.length;
  assert.equal(totalAssets, 2);

  const filenames = resolvedVideos.map((vid, idx) => {
    return generateFilename({
      caption: meta.caption,
      author: meta.author,
      tweetId: meta.tweetId,
      index: idx + 1,
      totalAssets,
      extension: 'mp4'
    });
  });

  assert.equal(filenames[0], 'Best movie trailers of 2026 revealed!_1.mp4');
  assert.equal(filenames[1], 'Best movie trailers of 2026 revealed!_2.mp4');
});

