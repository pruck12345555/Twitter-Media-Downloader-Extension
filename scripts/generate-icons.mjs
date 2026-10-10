// Generates valid PNG icons without external dependencies using built-in zlib & fs
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.resolve(__dirname, '../icons');

if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
}

function crc32(buf) {
  let table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }

  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function createChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const chunkType = Buffer.from(type, 'ascii');
  const typeAndData = Buffer.concat([chunkType, data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);

  return Buffer.concat([len, typeAndData, crc]);
}

function createPng(size) {
  const width = size;
  const height = size;

  // Raw image data with scanline filter byte (0) per row
  const rowLength = 1 + width * 4;
  const rawData = Buffer.alloc(rowLength * height);

  // Background color #1D9BF0 (Twitter blue)
  // Arrow color: White #FFFFFF
  const bgR = 29, bgG = 155, bgB = 240;
  const fgR = 255, fgG = 255, fgB = 255;

  const center = size / 2;
  const radius = size * 0.46;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowLength;
    rawData[rowOffset] = 0; // Filter: None

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;

      // Circle distance
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= radius) {
        // Simple download arrow geometry
        // Arrow shaft: vertical bar in middle
        // Arrow head: downward triangle
        // Tray: horizontal bar at bottom
        const nx = (x - center) / size; // -0.5 to 0.5
        const ny = (y - center) / size; // -0.5 to 0.5

        let isArrow = false;

        // Stem: |x| < 0.08, -0.25 <= y <= 0.08
        if (Math.abs(nx) <= 0.08 && ny >= -0.25 && ny <= 0.08) {
          isArrow = true;
        }
        // Head triangle: |x| <= (0.22 - ny) * 1.2 for ny between 0.05 and 0.22
        if (ny >= 0.05 && ny <= 0.22) {
          const maxW = (0.22 - ny) * 1.5;
          if (Math.abs(nx) <= maxW) {
            isArrow = true;
          }
        }
        // Bottom tray bar: |x| <= 0.24, 0.26 <= y <= 0.32
        if (Math.abs(nx) <= 0.24 && ny >= 0.26 && ny <= 0.33) {
          isArrow = true;
        }

        if (isArrow) {
          rawData[pxOffset] = fgR;
          rawData[pxOffset + 1] = fgG;
          rawData[pxOffset + 2] = fgB;
          rawData[pxOffset + 3] = 255;
        } else {
          rawData[pxOffset] = bgR;
          rawData[pxOffset + 1] = bgG;
          rawData[pxOffset + 2] = bgB;
          rawData[pxOffset + 3] = 255;
        }
      } else {
        // Transparent outside circular badge
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
      }
    }
  }

  // PNG Signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR Chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // Bit depth: 8
  ihdrData[9] = 6; // Color type: RGBA
  ihdrData[10] = 0; // Compression
  ihdrData[11] = 0; // Filter
  ihdrData[12] = 0; // Interlace
  const ihdrChunk = createChunk('IHDR', ihdrData);

  // IDAT Chunk
  const compressed = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressed);

  // IEND Chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

[16, 48, 128].forEach((size) => {
  const pngBuffer = createPng(size);
  const filePath = path.join(ICONS_DIR, `icon-${size}.png`);
  fs.writeFileSync(filePath, pngBuffer);
  console.log(`Generated icon: ${filePath} (${pngBuffer.length} bytes)`);
});
