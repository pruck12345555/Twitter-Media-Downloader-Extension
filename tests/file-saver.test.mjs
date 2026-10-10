import test from 'node:test';
import assert from 'node:assert/strict';
import { getMimeType } from '../src/utils/file-saver.js';

test('getMimeType - returns correct MIME types for extensions', () => {
  assert.equal(getMimeType('jpg'), 'image/jpeg');
  assert.equal(getMimeType('jpeg'), 'image/jpeg');
  assert.equal(getMimeType('.png'), 'image/png');
  assert.equal(getMimeType('mp4'), 'video/mp4');
  assert.equal(getMimeType('gif'), 'image/gif');
  assert.equal(getMimeType('webp'), 'image/webp');
  assert.equal(getMimeType('unknown'), 'image/jpeg');
});

test('downloadInParallel - fetches chunks concurrently and reports progress', async () => {
  const { downloadInParallel } = await import('../src/utils/file-saver.js');

  const totalSize = 12 * 1024 * 1024; // 12 MB
  const requestedRanges = [];
  const progressReports = [];

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options = {}) => {
      const headers = options.headers || {};
      const range = headers.Range || headers.range;

      if (range === 'bytes=0-0') {
        return {
          status: 206,
          ok: true,
          headers: new Map([
            ['content-range', `bytes 0-0/${totalSize}`],
            ['content-length', '1']
          ])
        };
      }

      if (range) {
        requestedRanges.push(range);
        const match = range.match(/bytes=(\d+)-(\d+)/);
        const start = parseInt(match[1], 10);
        const end = parseInt(match[2], 10);
        const len = end - start + 1;
        const chunk = new Uint8Array(len);
        return {
          status: 206,
          ok: true,
          headers: new Map([
            ['content-range', `bytes ${start}-${end}/${totalSize}`],
            ['content-length', String(len)]
          ]),
          arrayBuffer: async () => chunk.buffer
        };
      }

      return {
        status: 200,
        ok: true,
        headers: new Map([['content-length', String(totalSize)]]),
        blob: async () => new Blob([new Uint8Array(totalSize)])
      };
    };

    const blob = await downloadInParallel('https://video.twimg.com/test.mp4', {
      concurrency: 4,
      onProgress: (p) => progressReports.push(p)
    });

    assert.ok(blob instanceof Blob);
    assert.equal(requestedRanges.length, 4, 'Should have made 4 concurrent range requests');
    assert.ok(progressReports.length > 0, 'Should have reported progress');
    assert.equal(progressReports[progressReports.length - 1], 1, 'Final progress should be 100%');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
