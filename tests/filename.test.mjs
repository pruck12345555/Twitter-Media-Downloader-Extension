import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeCaption,
  normalizeAuthor,
  getExtensionFromUrl,
  generateFilename
} from '../src/utils/filename.js';

test('sanitizeCaption - strips URLs correctly', () => {
  const input = 'Check out this sunset! https://t.co/abc12345 http://example.com/foo';
  const result = sanitizeCaption(input);
  assert.equal(result, 'Check out this sunset!');
});

test('sanitizeCaption - removes filesystem illegal characters', () => {
  const input = 'Look: "Great / Amazing * Wild?" <Cat> | Dog \\ Mouse';
  const result = sanitizeCaption(input);
  assert.equal(result, 'Look Great Amazing Wild Cat Dog Mouse');
});

test('sanitizeCaption - collapses newlines and multiple spaces', () => {
  const input = 'Hello\n\nWorld!\r\nThis   is   a   test.';
  const result = sanitizeCaption(input);
  assert.equal(result, 'Hello World! This is a test');
});

test('sanitizeCaption - truncates long captions gracefully', () => {
  const longCaption = 'A'.repeat(150);
  const result = sanitizeCaption(longCaption, 50);
  assert.equal(result.length, 50);

  const words = 'The quick brown fox jumps over the lazy dog and runs through the vast open green forest';
  const resultWords = sanitizeCaption(words, 40);
  assert.ok(resultWords.length <= 40);
  // Ensures it didn't cut mid-word when space is available
  assert.ok(!resultWords.endsWith(' '));
});

test('sanitizeCaption - handles Windows reserved names', () => {
  assert.equal(sanitizeCaption('con'), 'con_');
  assert.equal(sanitizeCaption('aux'), 'aux_');
  assert.equal(sanitizeCaption('NUL'), 'NUL_');
});

test('getExtensionFromUrl - extracts format query and path extensions', () => {
  assert.equal(
    getExtensionFromUrl('https://pbs.twimg.com/media/abc?format=png&name=orig'),
    'png'
  );
  assert.equal(
    getExtensionFromUrl('https://pbs.twimg.com/media/abc?format=jpg&name=large'),
    'jpg'
  );
  assert.equal(
    getExtensionFromUrl('https://video.twimg.com/ext_tw_video/123/pu/vid/1280x720/xyz.mp4'),
    'mp4'
  );
  assert.equal(getExtensionFromUrl('https://example.com/image', 'jpg'), 'jpg');
});

test('generateFilename - single asset without numeric suffix', () => {
  const filename = generateFilename({
    caption: 'Sunset in Tokyo',
    author: 'traveler',
    tweetId: '98765',
    index: 1,
    totalAssets: 1,
    extension: 'jpg'
  });
  assert.equal(filename, 'Sunset in Tokyo.jpg');
});

test('generateFilename - multi-asset appends _1, _2 suffix', () => {
  const file1 = generateFilename({
    caption: 'Tokyo Night Walk',
    author: 'traveler',
    tweetId: '98765',
    index: 1,
    totalAssets: 3,
    extension: 'jpg'
  });
  const file2 = generateFilename({
    caption: 'Tokyo Night Walk',
    author: 'traveler',
    tweetId: '98765',
    index: 2,
    totalAssets: 3,
    extension: 'png'
  });

  assert.equal(file1, 'Tokyo Night Walk_1.jpg');
  assert.equal(file2, 'Tokyo Night Walk_2.png');
});

test('generateFilename - falls back to author and tweet ID when caption is blank', () => {
  const fallback = generateFilename({
    caption: '   https://t.co/xyz   ',
    author: '@photographer',
    tweetId: '1234567890',
    index: 1,
    totalAssets: 1,
    extension: 'jpg'
  });
  assert.equal(fallback, '@photographer_1234567890.jpg');
});

test('generateFilename - multi-asset fallback with empty caption', () => {
  const fallbackMulti = generateFilename({
    caption: '',
    author: 'artist',
    tweetId: '445566',
    index: 2,
    totalAssets: 4,
    extension: 'jpg'
  });
  assert.equal(fallbackMulti, '@artist_445566_2.jpg');
});
