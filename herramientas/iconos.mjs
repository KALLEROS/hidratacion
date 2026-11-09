// Dibuja los íconos de la app (un garrafón con agua) sin programas extra.
// Uso: node herramientas/iconos.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

const FONDO_ARRIBA = [0x2a, 0xa3, 0xdc];
const FONDO_ABAJO = [0x0e, 0x76, 0xae];
const VIDRIO = [0xf4, 0xfb, 0xfe];
const AGUA = [0x8f, 0xd3, 0xf2];
const TAPA = [0xff, 0xff, 0xff];

// Garrafón en un cuadro de 0 a 1: cuerpo redondeado, hombros, cuello y tapa.
function dentroCaja(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function forma(x, y) {
  // tapa
  if (dentroCaja(x, y, 0.405, 0.16, 0.595, 0.235, 0.025)) return 'tapa';
  // cuello
  if (dentroCaja(x, y, 0.43, 0.22, 0.57, 0.3, 0.01)) return 'vidrio';
  // hombros: elipse que une el cuello con el cuerpo
  const enHombro = y >= 0.28 && y <= 0.42 && ((x - 0.5) / 0.245) ** 2 + ((y - 0.42) / 0.14) ** 2 <= 1;
  const enCuerpo = y >= 0.42 && dentroCaja(x, y, 0.255, 0.2, 0.745, 0.86, 0.07);
  if (!enHombro && !enCuerpo) return null;
  // nivel de agua con una ola suave
  const ola = 0.565 + 0.012 * Math.sin((x - 0.255) * Math.PI * 4);
  if (y > ola) return 'agua';
  return 'vidrio';
}

function dibujar(tam) {
  const px = Buffer.alloc(tam * tam * 4);
  const S = 4; // submuestras por lado para bordes suaves
  for (let j = 0; j < tam; j++) {
    const t = j / (tam - 1);
    const fondo = FONDO_ARRIBA.map((c, i) => c + (FONDO_ABAJO[i] - c) * t);
    for (let i = 0; i < tam; i++) {
      const acum = [0, 0, 0];
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const x = (i + (sx + 0.5) / S) / tam, y = (j + (sy + 0.5) / S) / tam;
        const f = forma(x, y);
        const c = f === 'tapa' ? TAPA : f === 'agua' ? AGUA : f === 'vidrio' ? VIDRIO : fondo;
        acum[0] += c[0]; acum[1] += c[1]; acum[2] += c[2];
      }
      const o = (j * tam + i) * 4;
      px[o] = Math.round(acum[0] / (S * S));
      px[o + 1] = Math.round(acum[1] / (S * S));
      px[o + 2] = Math.round(acum[2] / (S * S));
      px[o + 3] = 255;
    }
  }
  return png(tam, px);
}

const TABLA = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABLA[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function trozo(tipo, datos) {
  const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length);
  const td = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([largo, td, c]);
}
function png(tam, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tam, 0); ihdr.writeUInt32BE(tam, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const filas = Buffer.alloc((tam * 4 + 1) * tam);
  for (let j = 0; j < tam; j++) {
    filas[j * (tam * 4 + 1)] = 0;
    rgba.copy(filas, j * (tam * 4 + 1) + 1, j * tam * 4, (j + 1) * tam * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr), trozo('IDAT', deflateSync(filas, { level: 9 })), trozo('IEND', Buffer.alloc(0))
  ]);
}

for (const t of [180, 192, 512]) {
  writeFileSync(join(raiz, `icon-${t}.png`), dibujar(t));
  console.log(`icon-${t}.png listo`);
}

writeFileSync(join(raiz, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2aa3dc"/><stop offset="1" stop-color="#0e76ae"/></linearGradient>
  <clipPath id="g"><path d="M43 29 C43 35 25.5 35 25.5 45 V79 Q25.5 86 32.5 86 H67.5 Q74.5 86 74.5 79 V45 C74.5 35 57 35 57 29 Z"/></clipPath></defs>
  <rect width="100" height="100" rx="22" fill="url(#f)"/>
  <rect x="43" y="22" width="14" height="8" rx="1" fill="#f4fbfe"/>
  <rect x="40.5" y="16" width="19" height="7.5" rx="2.5" fill="#fff"/>
  <path d="M43 29 C43 35 25.5 35 25.5 45 V79 Q25.5 86 32.5 86 H67.5 Q74.5 86 74.5 79 V45 C74.5 35 57 35 57 29 Z" fill="#f4fbfe"/>
  <path clip-path="url(#g)" d="M20 57 q7.5 -2.5 15 0 t15 0 t15 0 t15 0 t15 0 V90 H20 Z" fill="#8fd3f2"/>
</svg>
`);
console.log('icon.svg listo');
