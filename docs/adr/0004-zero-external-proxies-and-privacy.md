# 4. Zero External Proxies & Privacy-First Architecture

## Context
Third-party proxy resolvers (such as `vxtwitter`, `fxtwitter`, or unauthenticated web scrapers) are commonly used as lazy shortcuts in media downloaders to bypass Twitter's DOM obfuscation. However, routing requests through third-party servers presents severe security and privacy violations:
- Third-party server operators receive the user's IP address.
- Third-party servers receive the exact Tweet URLs and download IDs the user is viewing or saving.
- Third-party servers can log, aggregate, and track user browsing and download history.
- External proxy servers introduce an external point of failure and rate limits.

## Decision
We decided to enforce a strict **zero-external-proxy, 100% first-party architecture**:
1. All third-party domains (`api.vxtwitter.com`, `api.fxtwitter.com`, etc.) are permanently purged from the codebase.
2. `host_permissions` in `manifest.json` is restricted exclusively to official Twitter domains (`twitter.com`, `x.com`, `*.twimg.com`).
3. All video resolution happens locally in the browser:
   - In-memory GraphQL / XHR interception (`window.__TMD_MEDIA_CACHE__`).
   - In-memory React Fiber tree inspection (`__reactProps$`, `__reactFiber$`).
   - First-party internal authenticated queries (`x.com/i/api/1.1/...`) using the user's active session cookie (`ct0`).
4. Media bytes are fetched directly from Twitter's CDN (`video.twimg.com`, `pbs.twimg.com`) into a local browser `Blob`.

## Consequences
- Complete privacy guarantee: zero external logging, zero telemetry, zero history tracking.
- The extension remains resilient against third-party proxy downtime or API deprecation.
