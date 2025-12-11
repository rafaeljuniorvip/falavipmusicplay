const fs = require('fs');
const path = require('path');

// Simple PNG generator (creates solid color images)
function createPNG(width, height, r, g, b) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = createIHDR(width, height);

  // IDAT chunk (image data)
  const idat = createIDAT(width, height, r, g, b);

  // IEND chunk
  const iend = createIEND();

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createIHDR(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data.writeUInt8(8, 8);  // bit depth
  data.writeUInt8(2, 9);  // color type (RGB)
  data.writeUInt8(0, 10); // compression
  data.writeUInt8(0, 11); // filter
  data.writeUInt8(0, 12); // interlace

  return createChunk('IHDR', data);
}

function createIDAT(width, height, r, g, b) {
  const zlib = require('zlib');

  // Create raw image data (filter byte + RGB for each pixel)
  const rowSize = 1 + width * 3;
  const raw = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    const rowStart = y * rowSize;
    raw[rowStart] = 0; // filter type: none

    for (let x = 0; x < width; x++) {
      const pixelStart = rowStart + 1 + x * 3;
      raw[pixelStart] = r;
      raw[pixelStart + 1] = g;
      raw[pixelStart + 2] = b;
    }
  }

  const compressed = zlib.deflateSync(raw);
  return createChunk('IDAT', compressed);
}

function createIEND() {
  return createChunk('IEND', Buffer.alloc(0));
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcData);

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

// CRC32 implementation
function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  const table = getCRC32Table();

  for (let i = 0; i < buffer.length; i++) {
    crc = table[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  }

  return crc ^ 0xFFFFFFFF;
}

let crcTable = null;
function getCRC32Table() {
  if (crcTable) return crcTable;

  crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[i] = c;
  }
  return crcTable;
}

// Create assets directory
const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// Generate images
// FalaVIP theme color: #4fc3f7 (light blue) and #1a1a2e (dark)
const primary = { r: 79, g: 195, b: 247 };   // #4fc3f7
const dark = { r: 26, g: 26, b: 46 };        // #1a1a2e

console.log('Generating assets...');

// Icon (1024x1024) - light blue
const icon = createPNG(1024, 1024, primary.r, primary.g, primary.b);
fs.writeFileSync(path.join(assetsDir, 'icon.png'), icon);
console.log('✓ icon.png (1024x1024)');

// Adaptive icon (1024x1024) - light blue
const adaptiveIcon = createPNG(1024, 1024, primary.r, primary.g, primary.b);
fs.writeFileSync(path.join(assetsDir, 'adaptive-icon.png'), adaptiveIcon);
console.log('✓ adaptive-icon.png (1024x1024)');

// Splash (1284x2778) - dark background
const splash = createPNG(1284, 2778, dark.r, dark.g, dark.b);
fs.writeFileSync(path.join(assetsDir, 'splash.png'), splash);
console.log('✓ splash.png (1284x2778)');

// Favicon (48x48) - light blue
const favicon = createPNG(48, 48, primary.r, primary.g, primary.b);
fs.writeFileSync(path.join(assetsDir, 'favicon.png'), favicon);
console.log('✓ favicon.png (48x48)');

console.log('\nAssets generated successfully!');
console.log('Note: These are solid color placeholders. Replace with proper branding later.');
