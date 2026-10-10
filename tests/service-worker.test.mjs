import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadMediaItem, batchDownloadMedia, ACTIONS } from '../src/background/service-worker.js';

test('Background Service Worker - Actions enum is defined', () => {
  assert.equal(ACTIONS.DOWNLOAD_MEDIA, 'DOWNLOAD_MEDIA');
  assert.equal(ACTIONS.BATCH_DOWNLOAD_MEDIA, 'BATCH_DOWNLOAD_MEDIA');
  assert.equal(ACTIONS.PING, 'PING');
});

test('downloadMediaItem - rejects when url or filename is missing', async () => {
  const result1 = await downloadMediaItem(null);
  assert.equal(result1.success, false);
  assert.ok(result1.error.includes('Missing required'));

  const result2 = await downloadMediaItem({ url: 'https://example.com/test.jpg' });
  assert.equal(result2.success, false);

  const result3 = await downloadMediaItem({ filename: 'test.jpg' });
  assert.equal(result3.success, false);
});

test('downloadMediaItem - calls chrome.downloads.download with uniquify', async () => {
  let capturedOptions = null;
  globalThis.chrome = {
    runtime: {},
    downloads: {
      download: (options, callback) => {
        capturedOptions = options;
        callback(42); // mock downloadId = 42
      }
    }
  };

  const item = { url: 'https://pbs.twimg.com/media/abc.jpg', filename: 'awesome_post.jpg' };
  const res = await downloadMediaItem(item);

  assert.equal(res.success, true);
  assert.equal(res.downloadId, 42);
  assert.equal(capturedOptions.url, 'https://pbs.twimg.com/media/abc.jpg');
  assert.equal(capturedOptions.filename, 'awesome_post.jpg');
  assert.equal(capturedOptions.conflictAction, 'uniquify');
  assert.equal(capturedOptions.saveAs, true);
});

test('downloadMediaItem - returns error when chrome.runtime.lastError occurs', async () => {
  globalThis.chrome = {
    runtime: {
      lastError: { message: 'Download interrupted: user cancelled' }
    },
    downloads: {
      download: (options, callback) => {
        callback(undefined);
      }
    }
  };

  const item = { url: 'https://pbs.twimg.com/media/abc.jpg', filename: 'fail.jpg' };
  const res = await downloadMediaItem(item);

  assert.equal(res.success, false);
  assert.equal(res.error, 'Download interrupted: user cancelled');
});

test('batchDownloadMedia - processes multiple items in sequence', async () => {
  const downloaded = [];
  globalThis.chrome = {
    runtime: {},
    downloads: {
      download: (options, callback) => {
        downloaded.push(options.filename);
        callback(downloaded.length);
      }
    }
  };

  const items = [
    { url: 'https://example.com/1.jpg', filename: 'post_1.jpg' },
    { url: 'https://example.com/2.jpg', filename: 'post_2.jpg' }
  ];

  const results = await batchDownloadMedia(items);
  assert.equal(results.length, 2);
  assert.equal(results[0].success, true);
  assert.equal(results[1].success, true);
  assert.deepEqual(downloaded, ['post_1.jpg', 'post_2.jpg']);
});

test('fetchTweetMedia - successfully resolves media from Twitter syndication', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      assert.ok(url.includes('cdn.syndication.twimg.com'));
      return {
        ok: true,
        json: async () => ({
          mediaDetails: [
            {
              type: 'video',
              video_info: {
                variants: [
                  { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/amplify_video/vid.mp4' }
                ]
              }
            }
          ]
        })
      };
    };

    const { fetchTweetMedia } = await import('../src/background/service-worker.js');
    const res = await fetchTweetMedia('2100143267224633845');
    assert.equal(res.success, true);
    assert.ok(Array.isArray(res.media));
    assert.equal(res.media.length, 1);
    assert.equal(res.media[0].type, 'video');
    assert.equal(res.media[0].url, 'https://video.twimg.com/amplify_video/vid.mp4');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
