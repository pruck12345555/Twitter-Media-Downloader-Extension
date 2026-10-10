# 1. Media Extraction Strategy

Direct `<video>` tags on Twitter/X use Media Source Extensions (`blob:`) streaming segmented HLS chunks (`.m3u8`), hiding direct MP4 download links from the DOM.

We decided to extract video URLs by accessing Twitter's internal tweet data (intercepting syndication/GraphQL API responses or reading React fiber internal props) to retrieve the highest-bitrate MP4 variant directly. Images are resolved to their highest resolution by appending or replacing query parameters with `name=orig`. Only media directly attached to the target Tweet is extracted; quoted tweets are ignored.
