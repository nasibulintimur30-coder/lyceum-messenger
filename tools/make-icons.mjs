/**
 * Генератор иконок приложения.
 *
 * Иконки рисуются с нуля и кодируются в PNG средствами Node (zlib), чтобы
 * проект оставался без нативных зависимостей и графических библиотек.
 *
 * Запуск: npm run icons
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'web', 'icons');

const SUPERSAMPLE = 4;

/* --------------------------------------------------------------- PNG */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // глубина
  header[9] = 6; // RGBA
  header[10] = 0; // сжатие
  header[11] = 0; // фильтр
  header[12] = 0; // интерливинг

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // фильтр строки: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------ рисование */

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [
  Math.round(lerp(c1[0], c2[0], t)),
  Math.round(lerp(c1[1], c2[1], t)),
  Math.round(lerp(c1[2], c2[2], t)),
];

const GRADIENT_FROM = [124, 92, 255]; // #7c5cff
const GRADIENT_TO = [34, 211, 238]; // #22d3ee
const GLYPH = [10, 12, 21]; // #0a0c15

/** Молния внутри иконки (нормализованные координаты). */
const BOLT = [
  [0.585, 0.1],
  [0.29, 0.555],
  [0.455, 0.555],
  [0.415, 0.9],
  [0.71, 0.445],
  [0.545, 0.445],
];

function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function insideRoundedRect(x, y, size, radius) {
  if (radius <= 0) return true;
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Рисует иконку и возвращает буфер RGBA нужного размера.
 * @param {number} size итоговый размер в пикселях
 * @param {{ rounded?: boolean, scale?: number }} options
 */
function renderIcon(size, { rounded = true, scale = 1 } = {}) {
  const big = size * SUPERSAMPLE;
  const rgba = Buffer.alloc(big * big * 4);
  const radius = rounded ? big * 0.22 : 0;

  // Молня занимает центральную область и масштабируется
  const glyphScale = big * 0.62 * scale;
  const offsetX = (big - glyphScale) / 2;
  const offsetY = (big - glyphScale) / 2;
  const bolt = BOLT.map(([x, y]) => [offsetX + x * glyphScale, offsetY + y * glyphScale]);

  for (let y = 0; y < big; y += 1) {
    for (let x = 0; x < big; x += 1) {
      const index = (y * big + x) * 4;

      if (!insideRoundedRect(x + 0.5, y + 0.5, big, radius)) continue;

      const t = (x + y) / (2 * (big - 1));
      const color = mix(GRADIENT_FROM, GRADIENT_TO, t);

      const rgb = insidePolygon(x + 0.5, y + 0.5, bolt) ? GLYPH : color;
      rgba[index] = rgb[0];
      rgba[index + 1] = rgb[1];
      rgba[index + 2] = rgb[2];
      rgba[index + 3] = 255;
    }
  }

  // Усреднение суперсэмплов
  const out = Buffer.alloc(size * size * 4);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const index = ((y * SUPERSAMPLE + sy) * big + (x * SUPERSAMPLE + sx)) * 4;
          const alpha = rgba[index + 3];
          r += rgba[index] * alpha;
          g += rgba[index + 1] * alpha;
          b += rgba[index + 2] * alpha;
          a += alpha;
        }
      }
      const target = (y * size + x) * 4;
      out[target] = a ? Math.round(r / a) : 0;
      out[target + 1] = a ? Math.round(g / a) : 0;
      out[target + 2] = a ? Math.round(b / a) : 0;
      out[target + 3] = Math.round(a / samples);
    }
  }

  return out;
}

/* --------------------------------------------------------------- вывод */

const TARGETS = [
  { file: 'icon-192.png', size: 192, options: { rounded: true } },
  { file: 'icon-512.png', size: 512, options: { rounded: true } },
  { file: 'favicon.png', size: 64, options: { rounded: true } },
  // maskable: сплошная подложка и уменьшенный знак (безопасная зона 60%)
  { file: 'maskable-512.png', size: 512, options: { rounded: false, scale: 0.72 } },
];

mkdirSync(OUT_DIR, { recursive: true });

for (const { file, size, options } of TARGETS) {
  const rgba = renderIcon(size, options);
  const png = encodePng(size, size, rgba);
  writeFileSync(path.join(OUT_DIR, file), png);
  console.log(`  ✓ ${file} (${size}×${size}, ${(png.length / 1024).toFixed(1)} КБ)`);
}

console.log(`\n  Иконки готовы: ${OUT_DIR}\n`);
