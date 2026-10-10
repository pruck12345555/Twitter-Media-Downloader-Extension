import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scanAndCacheTwitterGraphQL,
  extractVideoFromReactNode
} from '../src/content/interceptor.js';

test('scanAndCacheTwitterGraphQL - caches standard video variants by tweetId', () => {
  globalThis.window = {
    __TMD_MEDIA_CACHE__: new Map()
  };

  const sampleGraphQL = {
    data: {
      tweetResult: {
        result: {
          rest_id: '1234567890',
          legacy: {
            extended_entities: {
              media: [
                {
                  type: 'video',
                  video_info: {
                    variants: [
                      { content_type: 'video/mp4', bitrate: 500000, url: 'https://video.twimg.com/low.mp4' },
                      { content_type: 'video/mp4', bitrate: 2000000, url: 'https://video.twimg.com/hd.mp4' }
                    ]
                  }
                }
              ]
            }
          }
        }
      }
    }
  };

  scanAndCacheTwitterGraphQL(sampleGraphQL);

  const cached = globalThis.window.__TMD_MEDIA_CACHE__.get('1234567890');
  assert.ok(cached, 'Cache should contain entry for tweet 1234567890');
  assert.equal(cached.length, 1);
  assert.equal(cached[0].type, 'video');
  assert.equal(cached[0].url, 'https://video.twimg.com/hd.mp4');
});

test('scanAndCacheTwitterGraphQL - extracts amplify video from unified_card', () => {
  globalThis.window = {
    __TMD_MEDIA_CACHE__: new Map()
  };

  const unifiedCardJson = JSON.stringify({
    media_entities: {
      amplify_1: {
        video_info: {
          variants: [
            { content_type: 'video/mp4', bitrate: 1500000, url: 'https://video.twimg.com/amplify_hd.mp4' }
          ]
        }
      }
    }
  });

  const sampleCardGraphQL = {
    id_str: '2100143267224633845',
    card: {
      legacy: {
        binding_values: [
          {
            key: 'unified_card',
            value: {
              type: 'STRING',
              string_value: unifiedCardJson
            }
          }
        ]
      }
    }
  };

  scanAndCacheTwitterGraphQL(sampleCardGraphQL);

  const cached = globalThis.window.__TMD_MEDIA_CACHE__.get('2100143267224633845');
  assert.ok(cached, 'Cache should contain entry for amplify tweet 2100143267224633845');
  assert.equal(cached.length, 1);
  assert.equal(cached[0].type, 'video');
  assert.equal(cached[0].url, 'https://video.twimg.com/amplify_hd.mp4');
});

test('extractVideoFromReactNode - extracts video variants from __reactProps$', () => {
  const fakeDomNode = {
    __reactProps$xyz: {
      children: {
        props: {
          video_info: {
            variants: [
              { content_type: 'video/mp4', bitrate: 800000, url: 'https://video.twimg.com/react_video.mp4' }
            ]
          }
        }
      }
    }
  };

  const variants = extractVideoFromReactNode(fakeDomNode);
  assert.ok(Array.isArray(variants));
  assert.equal(variants.length, 1);
  assert.equal(variants[0].url, 'https://video.twimg.com/react_video.mp4');
});

test('extractVideoFromReactNode - extracts video variants from __reactFiber$ memoizedProps', () => {
  const fakeDomNode = {
    __reactFiber$abc: {
      memoizedProps: {
        tweet: {
          extended_entities: {
            media: [
              {
                video_info: {
                  variants: [
                    { content_type: 'video/mp4', bitrate: 1200000, url: 'https://video.twimg.com/fiber_video.mp4' }
                  ]
                }
              }
            ]
          }
        }
      }
    }
  };

  const variants = extractVideoFromReactNode(fakeDomNode);
  assert.ok(Array.isArray(variants));
  assert.equal(variants.length, 1);
  assert.equal(variants[0].url, 'https://video.twimg.com/fiber_video.mp4');
});

test('extractVideoFromReactNode - climbs fiber.return tree and handles array children', () => {
  const deepChildNode = {
    __reactFiber$leaf: {
      return: {
        return: {
          memoizedProps: {
            children: [
              { notMe: true },
              {
                playerState: {
                  video_info: {
                    variants: [
                      { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/climbed_parent.mp4' }
                    ]
                  }
                }
              }
            ]
          }
        }
      }
    }
  };

  const variants = extractVideoFromReactNode(deepChildNode);
  assert.ok(Array.isArray(variants));
  assert.equal(variants.length, 1);
  assert.equal(variants[0].url, 'https://video.twimg.com/climbed_parent.mp4');
});

test('fetchTweetFromInternalTwitterApi - resolves video from Twitter internal API with session credentials', async () => {
  const { fetchTweetFromInternalTwitterApi } = await import('../src/content/interceptor.js');
  globalThis.document = {
    cookie: 'ct0=abcdef1234567890; auth_token=mockauth;'
  };
  globalThis.window = {
    __TMD_MEDIA_CACHE__: new Map()
  };

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.ok(url.includes('/i/api/1.1/statuses/show.json?id=2100143267224633845'));
      assert.equal(options.credentials, 'include');
      assert.equal(options.headers['x-csrf-token'], 'abcdef1234567890');
      return {
        ok: true,
        json: async () => ({
          id_str: '2100143267224633845',
          extended_entities: {
            media: [
              {
                type: 'video',
                video_info: {
                  variants: [
                    { content_type: 'video/mp4', bitrate: 3000000, url: 'https://video.twimg.com/internal_hd.mp4' }
                  ]
                }
              }
            ]
          }
        })
      };
    };

    const videoUrl = await fetchTweetFromInternalTwitterApi('2100143267224633845');
    assert.equal(videoUrl, 'https://video.twimg.com/internal_hd.mp4');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('inspectObjectForAllMediaItems - extracts all videos from multi-video extended_entities', async () => {
  const { inspectObjectForAllMediaItems } = await import('../src/content/interceptor.js');

  const tweetObj = {
    extended_entities: {
      media: [
        {
          id_str: 'vid1',
          type: 'video',
          video_info: {
            variants: [
              { content_type: 'video/mp4', bitrate: 500000, url: 'https://video.twimg.com/v1_low.mp4' },
              { content_type: 'video/mp4', bitrate: 2000000, url: 'https://video.twimg.com/v1_high.mp4' }
            ]
          }
        },
        {
          id_str: 'vid2',
          type: 'video',
          video_info: {
            variants: [
              { content_type: 'video/mp4', bitrate: 400000, url: 'https://video.twimg.com/v2_low.mp4' },
              { content_type: 'video/mp4', bitrate: 1800000, url: 'https://video.twimg.com/v2_high.mp4' }
            ]
          }
        }
      ]
    }
  };

  const items = inspectObjectForAllMediaItems(tweetObj);
  assert.equal(items.length, 2);
  assert.equal(items[0].type, 'video');
  assert.equal(items[0].url, 'https://video.twimg.com/v1_high.mp4');
  assert.equal(items[1].type, 'video');
  assert.equal(items[1].url, 'https://video.twimg.com/v2_high.mp4');
});

test('inspectObjectForAllMediaItems - extracts mixed media (video and photo)', async () => {
  const { inspectObjectForAllMediaItems } = await import('../src/content/interceptor.js');

  const tweetObj = {
    extended_entities: {
      media: [
        {
          id_str: 'vid1',
          type: 'video',
          video_info: {
            variants: [
              { content_type: 'video/mp4', bitrate: 1500000, url: 'https://video.twimg.com/v1.mp4' }
            ]
          }
        },
        {
          id_str: 'photo1',
          type: 'photo',
          media_url_https: 'https://pbs.twimg.com/media/pic1.jpg'
        }
      ]
    }
  };

  const items = inspectObjectForAllMediaItems(tweetObj);
  assert.equal(items.length, 2);
  assert.equal(items[0].type, 'video');
  assert.equal(items[0].url, 'https://video.twimg.com/v1.mp4');
  assert.equal(items[1].type, 'image');
  assert.equal(items[1].url, 'https://pbs.twimg.com/media/pic1?format=jpg&name=orig');
});

test('extractAllVideosFromTweet - extracts all videos from multi-video React Fiber tree', async () => {
  const { extractAllVideosFromTweet } = await import('../src/content/interceptor.js');

  const container1 = {
    attributes: { 'data-testid': 'videoComponent' },
    querySelectorAll: () => [],
    closest: () => null,
    __reactProps$1: {
      video_info: {
        variants: [
          { content_type: 'video/mp4', bitrate: 2500000, url: 'https://video.twimg.com/fiber_v1.mp4' }
        ]
      }
    }
  };

  const container2 = {
    attributes: { 'data-testid': 'videoComponent' },
    querySelectorAll: () => [],
    closest: () => null,
    __reactProps$2: {
      video_info: {
        variants: [
          { content_type: 'video/mp4', bitrate: 3000000, url: 'https://video.twimg.com/fiber_v2.mp4' }
        ]
      }
    }
  };

  const fakeTweetElement = {
    querySelectorAll: (selector) => {
      if (selector.includes('videoPlayer') || selector.includes('videoComponent')) {
        return [container1, container2];
      }
      return [];
    },
    closest: () => null,
    __reactProps$tweet: {}
  };

  const videos = extractAllVideosFromTweet(fakeTweetElement);
  assert.equal(videos.length, 2);
  assert.equal(videos[0].url, 'https://video.twimg.com/fiber_v1.mp4');
  assert.equal(videos[1].url, 'https://video.twimg.com/fiber_v2.mp4');
});

test('resolveAllTweetMedia - deduplicates single photo post (cached raw + DOM orig = 1 item)', async () => {
  const { resolveAllTweetMedia } = await import('../src/content/interceptor.js');

  const tweetId = '999888777';
  globalThis.window = {
    __TMD_MEDIA_CACHE__: new Map([
      [tweetId, [{ type: 'image', url: 'https://pbs.twimg.com/media/SamePhoto123.jpg' }]]
    ])
  };

  const fakeTweetElement = {
    querySelectorAll: (selector) => {
      if (selector.includes('pbs.twimg.com/media/')) {
        return [
          {
            getAttribute: (attr) => attr === 'src' ? 'https://pbs.twimg.com/media/SamePhoto123?format=jpg&name=orig' : null,
            closest: () => null
          }
        ];
      }
      return [];
    },
    closest: () => null
  };

  const media = await resolveAllTweetMedia(fakeTweetElement, tweetId);
  assert.equal(media.length, 1, 'Single photo must resolve to exactly 1 media item, not 2');
  assert.equal(media[0].type, 'image');
  assert.equal(media[0].url, 'https://pbs.twimg.com/media/SamePhoto123?format=jpg&name=orig');
});

test('resolveAllTweetMedia - resolves single video tweet correctly', async () => {
  const { resolveAllTweetMedia } = await import('../src/content/interceptor.js');

  const tweetId = '1122334455';
  globalThis.window = {
    __TMD_MEDIA_CACHE__: new Map()
  };

  const videoContainer = {
    attributes: { 'data-testid': 'videoComponent' },
    querySelectorAll: () => [],
    closest: () => null,
    __reactProps$vid: {
      video_info: {
        variants: [
          { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/single_best.mp4' },
          { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/single_low.mp4' }
        ]
      }
    }
  };

  const fakeTweetElement = {
    querySelectorAll: (selector) => {
      if (selector.includes('videoPlayer') || selector.includes('videoComponent')) {
        return [videoContainer];
      }
      if (selector.includes('video')) {
        return [videoContainer];
      }
      return [];
    },
    closest: () => null,
    __reactProps$tweet: {}
  };

  const media = await resolveAllTweetMedia(fakeTweetElement, tweetId);
  const vids = media.filter((m) => m.type === 'video');
  assert.equal(vids.length, 1, 'Single video must resolve to exactly 1 video');
  assert.equal(vids[0].url, 'https://video.twimg.com/single_best.mp4');
});

test('resolveAllTweetMedia - falls back to Twitter syndication if video not in React tree', async () => {
  const { resolveAllTweetMedia } = await import('../src/content/interceptor.js');

  const tweetId = '5566778899';
  globalThis.window = {
    __TMD_MEDIA_CACHE__: new Map()
  };

  // Video container exists in DOM but no React props attached
  const videoContainer = {
    attributes: { 'data-testid': 'videoPlayer' },
    querySelectorAll: () => [],
    closest: () => null
  };

  const fakeTweetElement = {
    querySelectorAll: (selector) => {
      if (selector.includes('videoPlayer') || selector.includes('videoComponent')) {
        return [videoContainer];
      }
      return [];
    },
    closest: () => null
  };

  // Mock global fetch for syndication
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.includes('cdn.syndication.twimg.com/tweet-result')) {
      return {
        ok: true,
        json: async () => ({
          mediaDetails: [
            {
              type: 'video',
              video_info: {
                variants: [
                  { content_type: 'video/mp4', bitrate: 3000000, url: 'https://video.twimg.com/syndication_video.mp4' }
                ]
              }
            }
          ]
        })
      };
    }
    return { ok: false, status: 404 };
  };

  try {
    const media = await resolveAllTweetMedia(fakeTweetElement, tweetId);
    const vids = media.filter((m) => m.type === 'video');
    assert.equal(vids.length, 1, 'Syndication fallback must resolve missing video');
    assert.equal(vids[0].url, 'https://video.twimg.com/syndication_video.mp4');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('resolveAllTweetMedia - handles NSFW / age-restricted tweets when syndication returns TweetTombstone', async () => {
  const { resolveAllTweetMedia } = await import('../src/content/interceptor.js');

  const nsfwTweetId = '2100143267224633845';
  globalThis.window = {
    __TMD_MEDIA_CACHE__: new Map([
      [nsfwTweetId, [{ type: 'video', url: 'https://video.twimg.com/nsfw_authenticated_video.mp4' }]]
    ])
  };

  const fakeTweetElement = {
    querySelectorAll: (selector) => {
      if (selector.includes('videoPlayer') || selector.includes('videoComponent')) {
        return [{ attributes: { 'data-testid': 'videoPlayer' }, querySelectorAll: () => [], closest: () => null }];
      }
      return [];
    },
    closest: () => null
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    // If syndication is queried for NSFW tweet, it returns TweetTombstone
    if (url.includes('cdn.syndication.twimg.com')) {
      return {
        ok: true,
        json: async () => ({ __typename: 'TweetTombstone', tombstone: {} })
      };
    }
    return { ok: false, status: 404 };
  };

  try {
    const media = await resolveAllTweetMedia(fakeTweetElement, nsfwTweetId);
    const vids = media.filter((m) => m.type === 'video');
    assert.equal(vids.length, 1, 'Must resolve NSFW video from authenticated cache despite syndication tombstone');
    assert.equal(vids[0].url, 'https://video.twimg.com/nsfw_authenticated_video.mp4');
  } finally {
    globalThis.fetch = origFetch;
  }
});


