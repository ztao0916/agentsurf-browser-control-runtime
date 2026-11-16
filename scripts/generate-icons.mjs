import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const outputDirectory = new URL('../src/icons/', import.meta.url);
await mkdir(outputDirectory, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  await writeFile(new URL(`icon${size}.png`, outputDirectory), createIcon(size));
}

function createIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const sub = 4;
  const invSub = 1 / sub;
  const weight = 1 / (sub * sub);
  const arrow = [[68, 22], [104, 90], [80, 81], [69, 105], [56, 78]];
  const arrowShadow = arrow.map(([x, y]) => [x + 2, y + 3]);

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let accR = 0;
      let accG = 0;
      let accB = 0;
      let accA = 0;

      for (let sy = 0; sy < sub; sy += 1) {
        const y = ((py + (sy + 0.5) * invSub) / size) * 128;
        for (let sx = 0; sx < sub; sx += 1) {
          const x = ((px + (sx + 0.5) * invSub) / size) * 128;
          const sample = sampleScene(x, y, arrow, arrowShadow);
          const a = sample[3] / 255;
          accR += sample[0] * a * weight;
          accG += sample[1] * a * weight;
          accB += sample[2] * a * weight;
          accA += a * weight;
        }
      }

      const offset = (py * size + px) * 4;
      if (accA > 0) {
        pixels[offset] = Math.min(255, Math.round(accR / accA));
        pixels[offset + 1] = Math.min(255, Math.round(accG / accA));
        pixels[offset + 2] = Math.min(255, Math.round(accB / accA));
        pixels[offset + 3] = Math.min(255, Math.round(accA * 255));
      }
    }
  }
  return encodePng(size, size, pixels);
}

function sampleScene(x, y, arrow, arrowShadow) {
  // Rounded square centered at (64, 64), radius 26, half-extent 60
  const dist = roundedBoxSdf(x - 64, y - 64, 60, 60, 26);
  if (dist > 0) return [0, 0, 0, 0];

  const t = (x + y) / 256;
  let r = 11 + t * 9;
  let g = 31 + t * 23;
  let b = 56 + t * 40;

  // Subtle top inner highlight
  if (dist > -2 && y < 64) {
    const sheen = 0.14 * (1 - y / 64);
    r += (255 - r) * sheen;
    g += (255 - g) * sheen;
    b += (255 - b) * sheen;
  }

  // Teal-to-sky surf wave clipped inside rounded square
  if (x >= 10 && x <= 118) {
    const waveY = 92 - Math.sin(((x - 10) / 108) * Math.PI) * 15;
    const halfStroke = 4.6;
    if (Math.abs(y - waveY) <= halfStroke) {
      const wt = (x - 10) / 108;
      r = 38 + wt * 18;
      g = 212 - wt * 22;
      b = 188 + wt * 60;
    }
  }

  // Soft shadow under pointer
  if (pointInPolygon(x, y, arrowShadow)) {
    r *= 0.48;
    g *= 0.48;
    b *= 0.48;
  }

  // Crisp white pointer
  if (pointInPolygon(x, y, arrow)) {
    return [255, 255, 255, 255];
  }

  return [Math.round(r), Math.round(g), Math.round(b), 255];
}

function roundedBoxSdf(dx, dy, halfW, halfH, radius) {
  const qx = Math.abs(dx) - (halfW - radius);
  const qy = Math.abs(dy) - (halfH - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
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
