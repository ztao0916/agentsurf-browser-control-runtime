import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const outputDirectory = new URL('../src/icons/', import.meta.url);
await mkdir(outputDirectory, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  await writeFile(new URL(`icon${size}.png`, outputDirectory), createIcon(size));
}

function createIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const setPixel = (x, y, color) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const offset = (y * size + x) * 4;
    pixels.set(color, offset);
  };
  const scale = size / 128;
  const center = size / 2;
  const radius = size * 0.16;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
      const distance = Math.hypot(x - center, y - center);
      const alpha = edge < radius && distance > size / 2 - radius ? 0 : 255;
      setPixel(x, y, [11, 31, 51, alpha]);
    }
  }
  for (let x = 20; x <= 108; x += 1) {
    const waveY = 91 - Math.sin((x - 20) / 88 * Math.PI) * 13;
    for (let y = Math.floor(waveY - 4); y <= Math.ceil(waveY + 4); y += 1) {
      setPixel(Math.round(x * scale), Math.round(y * scale), [45, 211, 191, 255]);
    }
  }
  const points = [[70, 25], [104, 93], [82, 84], [72, 106], [59, 81]];
  fillPolygon(points.map(([x, y]) => [x * scale, y * scale]), [255, 255, 255, 255], setPixel);
  return encodePng(size, size, pixels);
}

function fillPolygon(points, color, setPixel) {
  const minY = Math.floor(Math.min(...points.map((point) => point[1])));
  const maxY = Math.ceil(Math.max(...points.map((point) => point[1])));
  for (let y = minY; y <= maxY; y += 1) {
    const intersections = [];
    for (let index = 0; index < points.length; index += 1) {
      const [x1, y1] = points[index];
      const [x2, y2] = points[(index + 1) % points.length];
      if ((y1 <= y && y < y2) || (y2 <= y && y < y1)) intersections.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
    }
    intersections.sort((a, b) => a - b);
    for (let index = 0; index < intersections.length; index += 2) {
      for (let x = Math.ceil(intersections[index]); x <= intersections[index + 1]; x += 1) setPixel(x, y, color);
    }
  }
}

function encodePng(width, height, pixels) {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rows[y * (width * 4 + 1)] = 0;
    pixels.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const imageHeader = Buffer.alloc(13);
  imageHeader.writeUInt32BE(width, 0);
  imageHeader.writeUInt32BE(height, 4);
  imageHeader.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([header, chunk('IHDR', imageHeader), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])) >>> 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
  }
  return crc ^ 0xffffffff;
}
