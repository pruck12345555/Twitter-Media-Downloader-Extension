import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectHighestBitrateVideo,
  parseMediaFromSyndication
} from '../src/utils/video.js';

test('selectHighestBitrateVideo - selects highest bitrate MP4 variant', () => {
  const variants = [
    { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/hls.m3u8' },
    { content_type: 'video/mp4', bitrate: 256000, url: 'https://video.twimg.com/low.mp4' },
    { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/1080p.mp4' },
    { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/720p.mp4' }
  ];

  const selected = selectHighestBitrateVideo(variants);
  assert.equal(selected, 'https://video.twimg.com/1080p.mp4');
});

test('selectHighestBitrateVideo - handles empty or missing variants', () => {
  assert.equal(selectHighestBitrateVideo([]), null);
  assert.equal(selectHighestBitrateVideo(null), null);
});

test('selectHighestBitrateVideo - falls back if no mp4 bitrate variant', () => {
  const variants = [
    { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/hls.m3u8' }
  ];
  const selected = selectHighestBitrateVideo(variants);
  assert.equal(selected, 'https://video.twimg.com/hls.m3u8');
});

test('parseMediaFromSyndication - extracts video and converts images to original quality', () => {
  const syndicationData = {
    mediaDetails: [
      {
        type: 'photo',
        media_url_https: 'https://pbs.twimg.com/media/Photo1?format=jpg&name=medium'
      },
      {
        type: 'video',
        video_info: {
          variants: [
            { content_type: 'video/mp4', bitrate: 500000, url: 'https://video.twimg.com/vid_low.mp4' },
            { content_type: 'video/mp4', bitrate: 3000000, url: 'https://video.twimg.com/vid_hd.mp4' }
          ]
        }
      }
    ]
  };

  const parsed = parseMediaFromSyndication(syndicationData);
  assert.equal(parsed.length, 2);

  assert.equal(parsed[0].type, 'image');
  assert.equal(parsed[0].url, 'https://pbs.twimg.com/media/Photo1?format=jpg&name=orig');

  assert.equal(parsed[1].type, 'video');
  assert.equal(parsed[1].url, 'https://video.twimg.com/vid_hd.mp4');
});

test('parseMediaFromSyndication - handles animated_gif', () => {
  const syndicationData = {
    mediaDetails: [
      {
        type: 'animated_gif',
        video_info: {
          variants: [
            { content_type: 'video/mp4', bitrate: 0, url: 'https://video.twimg.com/loop.mp4' }
          ]
        }
      }
    ]
  };

  const parsed = parseMediaFromSyndication(syndicationData);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].type, 'video');
  assert.equal(parsed[0].url, 'https://video.twimg.com/loop.mp4');
});
