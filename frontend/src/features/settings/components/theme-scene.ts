/**
 * Mavzu banneri sahnasi: tinch, oynadek suv ustida tuman; past kamera (ufq — pastki uchdan birda).
 * Hammasi kod bilan chiziladi (rasm/video yo'q). Bu fayl — toza hisob va canvas chizish; holat va
 * animatsiya sikli `ThemeSceneToggle.tsx`da.
 *
 * Sahna holati bitta son bilan beriladi: `p` — o'tishning borishi (0..1) va yo'nalish:
 *   toDay  (quyosh chiqishi): tun → binafsha (tong oldi) → oltin tong → kunduz
 *   toNight (quyosh botishi): kunduz → binafsha → to'q sariq/pushti shom → tun
 * Tinch holatlar: tun = { toDay, p: 0 }, kunduz = { toDay, p: 1 }.
 */

export type Rgb = readonly [number, number, number];
export type Direction = 'toDay' | 'toNight';

export interface SceneState {
  dir: Direction;
  p: number;
  /** Harakat kamaytirilgan: oraliq bosqichlarsiz to'g'ridan-to'g'ri aralashtirish. */
  direct: boolean;
}

interface Sky {
  top: Rgb;
  mid: Rgb;
  horizon: Rgb;
}
interface SkyKey extends Sky {
  at: number;
}

// --- Osmon kalit kadrlari ---------------------------------------------------------------------------
const NIGHT: Sky = { top: [3, 5, 16], mid: [10, 15, 40], horizon: [32, 40, 82] };
const PREDAWN: Sky = { top: [24, 20, 64], mid: [80, 52, 124], horizon: [176, 110, 162] };
const SUNRISE: Sky = { top: [58, 92, 168], mid: [206, 150, 150], horizon: [255, 196, 128] };
const DAY: Sky = { top: [22, 92, 196], mid: [86, 156, 230], horizon: [206, 228, 246] };
const DUSK: Sky = { top: [54, 66, 150], mid: [130, 104, 184], horizon: [216, 160, 198] };
const SUNSET: Sky = { top: [36, 26, 84], mid: [152, 70, 128], horizon: [255, 146, 78] };

const KEYS: Record<Direction, SkyKey[]> = {
  toDay: [
    { at: 0, ...NIGHT },
    { at: 0.33, ...PREDAWN },
    { at: 0.64, ...SUNRISE },
    { at: 1, ...DAY },
  ],
  toNight: [
    { at: 0, ...DAY },
    { at: 0.3, ...DUSK },
    { at: 0.62, ...SUNSET },
    { at: 1, ...NIGHT },
  ],
};
const DIRECT_KEYS: Record<Direction, SkyKey[]> = {
  toDay: [
    { at: 0, ...NIGHT },
    { at: 1, ...DAY },
  ],
  toNight: [
    { at: 0, ...DAY },
    { at: 1, ...NIGHT },
  ],
};

// --- Yordamchi matematika ---------------------------------------------------------------------------
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
const smoothstep = (a: number, b: number, v: number) => smooth(clamp01((v - a) / (b - a)));
/** Qo'ng'iroqsimon egri: `c` atrofida 1, undan uzoqlashgan sari 0. */
const bell = (v: number, c: number, w: number) => Math.exp(-(((v - c) / w) ** 2));
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];
const rgba = (c: Rgb, a = 1) =>
  `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${clamp01(a).toFixed(3)})`;
const WHITE: Rgb = [255, 255, 255];
const MOON: Rgb = [236, 238, 255];

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

function skyAt(keys: SkyKey[], p: number): Sky {
  let i = 0;
  while (i < keys.length - 2 && p > keys[i + 1]!.at) i++;
  const a = keys[i]!;
  const b = keys[i + 1]!;
  const t = smooth(clamp01((p - a.at) / (b.at - a.at)));
  return {
    top: mix(a.top, b.top, t),
    mid: mix(a.mid, b.mid, t),
    horizon: mix(a.horizon, b.horizon, t),
  };
}

/** Sahna parametrlari: rang va har bir qatlamning "kuchi" (0..1). */
export interface SceneParams {
  sky: Sky;
  /** Yulduzlar, oy va qalin tuman. */
  night: number;
  /** Shom/tong iliqligi: bulutlar pastdan yoritiladi, ufq yonadi. */
  warmth: number;
  /** Quyosh: balandligi (0 — ufqda, 1 — kunduzgi joyida, <0 — ufq ostida). */
  sun: number;
  /** Oy: balandligi (1 — tungi joyida, 0 — ufqda, <0 — ufq ostida). */
  moon: number;
}

export function sceneParams({ dir, p, direct }: SceneState): SceneParams {
  const sky = skyAt((direct ? DIRECT_KEYS : KEYS)[dir], p);
  if (direct) {
    const day = dir === 'toDay' ? p : 1 - p;
    return { sky, night: 1 - day, warmth: 0, sun: day > 0.5 ? 1 : -1, moon: day > 0.5 ? -1 : 1 };
  }
  if (dir === 'toDay') {
    return {
      sky,
      night: 1 - smoothstep(0.2, 0.62, p),
      warmth: bell(p, 0.62, 0.17),
      // Quyosh tong oldidan keyin ufqdan ko'tariladi
      sun: lerp(-0.12, 1, 1 - (1 - smoothstep(0.38, 1, p)) ** 3),
      // Oy tong otguncha g'arbga — ufq ortiga botadi
      moon: lerp(1, -0.3, smoothstep(0, 0.52, p) ** 1.3),
    };
  }
  return {
    sky,
    night: smoothstep(0.62, 0.95, p),
    warmth: bell(p, 0.6, 0.17),
    // Quyosh shomgacha ufqqa tushadi va uning ortiga botadi
    sun: lerp(1, -0.15, smoothstep(0, 0.74, p) ** 1.6),
    // Oy quyosh botgach sharqdan — ufqdan ko'tariladi
    moon: lerp(-0.3, 1, 1 - (1 - smoothstep(0.48, 1, p)) ** 2.2),
  };
}

// --- Shovqin (value noise + fbm): bulut, tuman, oy va Somon yo'li teksturalari uchun -------------------
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

type Noise2 = (x: number, y: number, period?: number) => number;

/** Seed'li 2D value noise (0..1). `period` berilsa — x bo'yicha davriy (chok ko'rinmaydigan tekstura). */
function makeNoise(seed: number): Noise2 {
  const r = rng(seed);
  const perm = new Uint8Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [base[i], base[j]] = [base[j]!, base[i]!];
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255]!;
  const values = Float32Array.from({ length: 256 }, () => r());
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y, period = 0) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const wx = (i: number) => (period ? ((i % period) + period) % period : i) & 255;
    const v = (i: number, j: number) => values[perm[perm[wx(i)]! + (j & 255)]!]!;
    const u = fade(xf);
    const w = fade(yf);
    return lerp(lerp(v(xi, yi), v(xi + 1, yi), u), lerp(v(xi, yi + 1), v(xi + 1, yi + 1), u), w);
  };
}

function fbm(noise: Noise2, x: number, y: number, octaves: number, period = 0): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * f, y * f, period ? period * f : 0);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/**
 * Hujayra (Worley) shovqini: eng yaqin tasodifiy nuqtagacha masofa (F1). `1 − F1` — yumaloq do'mboqlar;
 * bir necha masshtabda qo'shilsa kumulusning "gulkaram" yuzasi chiqadi.
 */
function makeWorley(seed: number): Noise2 {
  const r = rng(seed);
  const pts = Float32Array.from({ length: 512 }, () => r());
  const hash = (i: number, j: number) => (((i & 1023) * 73856093) ^ ((j & 1023) * 19349663)) & 255;
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let best = 9;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const h = hash(xi + di, yi + dj) * 2;
        const dx = xi + di + pts[h]! - x;
        const dy = yi + dj + pts[h + 1]! - y;
        const d = dx * dx + dy * dy;
        if (d < best) best = d;
      }
    }
    return Math.sqrt(best);
  };
}

// --- Sahna "aktivlari": tasodifiy, lekin har safar bir xil (o'lchamga nisbiy) -----------------------
interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
  speed: number;
  color: Rgb;
}
interface CloudSlot {
  x: number;
  y: number;
  /** Banner balandligiga nisbatan bulut kengligi. */
  width: number;
  speed: number;
  sprite: number;
  /** 0 — yaqin (tepada, katta), 1 — ufq yonida (kichik, havo pardasi ortida xira). */
  depth: number;
}
export interface SceneAssets {
  stars: Star[];
  clouds: CloudSlot[];
  /** Uzoq va yaqinroq qirg'oq tepaliklari (0..1 balandliklar). */
  farHills: number[];
  nearHills: number[];
  /** Brauzerda bir marta generatsiya qilinadigan teksturalar (jsdom'da yo'q). */
  textures: SceneTextures | null;
}

const STAR_COLORS: Rgb[] = [
  [255, 255, 255],
  [205, 220, 255],
  [255, 236, 214],
  [228, 236, 255],
];

export function createSceneAssets(seed = 7): SceneAssets {
  const r = rng(seed);
  const stars = Array.from({ length: 220 }, () => ({
    x: r(),
    y: r() ** 1.35 * 0.95, // tepada zichroq, ufq yonida siyrak (havo qalin)
    // Ko'pi mayda, oz qismi yorqin
    r: r() < 0.06 ? 1.1 + r() * 0.8 : 0.35 + r() * 0.65,
    phase: r() * Math.PI * 2,
    speed: 0.5 + r() * 2,
    color: STAR_COLORS[Math.floor(r() * STAR_COLORS.length)]!,
  }));
  // Perspektiva: tepadagi bulutlar yaqin va katta, ufqqa yaqinlashgan sari kichrayadi va sekinlashadi
  const clouds: CloudSlot[] = [
    { x: 0.04, y: 0.2, width: 1.25, speed: 0.0042, sprite: 0, depth: 0.1 },
    { x: 0.52, y: 0.13, width: 1.4, speed: 0.0036, sprite: 1, depth: 0.05 },
    { x: 0.3, y: 0.46, width: 0.78, speed: 0.0031, sprite: 2, depth: 0.45 },
    { x: 0.78, y: 0.5, width: 0.66, speed: 0.0028, sprite: 3, depth: 0.55 },
    { x: 0.12, y: 0.7, width: 0.44, speed: 0.0021, sprite: 4, depth: 0.82 },
    { x: 0.6, y: 0.76, width: 0.36, speed: 0.0019, sprite: 5, depth: 0.9 },
    { x: 0.9, y: 0.8, width: 0.3, speed: 0.0017, sprite: 2, depth: 0.95 },
  ];
  const hills = (n: number, f1: number, f2: number) =>
    Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      return clamp01(
        0.45 + 0.35 * Math.sin(t * f1 + r() * 0.3) * Math.sin(t * f2 + 1.1) + 0.2 * r(),
      );
    });
  return {
    stars,
    clouds,
    farHills: hills(48, 9.3, 2.1),
    nearHills: hills(40, 5.2, 1.4),
    textures: null,
  };
}

// --- Teksturalar (bir marta, offscreen canvas'da) ---------------------------------------------------
export interface SceneTextures {
  /** Kunduzgi (quyosh tomondan yoritilgan, tagi ko'kimtir soyada) va shom (ufqdan iliq) bulutlar. */
  cloudsDay: HTMLCanvasElement[];
  cloudsWarm: HTMLCanvasElement[];
  /** Baland patsimon (cirrus) bulutlar: kunduzgi oq va shom pushti-oltin varianti. */
  cirrusDay: HTMLCanvasElement;
  cirrusWarm: HTMLCanvasElement;
  /** Suv yuzasidagi cho'zinchoq to'lqinlar (kulrang, `overlay` bilan aksni yoritadi/soya qiladi). */
  ripple: HTMLCanvasElement;
  ripplePattern?: CanvasPattern | null;
  moon: HTMLCanvasElement;
  milkyWay: HTMLCanvasElement;
  mist: HTMLCanvasElement;
  grain: HTMLCanvasElement;
  /** Har kadrda osmon shu yerga chiziladi, keyin suvga ko'zgu sifatida ko'chiriladi. */
  sky: HTMLCanvasElement;
  /** Osmonning kichraytirilgan nusxasi — suvdagi aks tabiiy xira (va arzon) bo'lishi uchun. */
  skySmall: HTMLCanvasElement;
  grainPattern?: CanvasPattern | null;
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Kumulus bulut (haqiqiy suratlarga qarab), ikki yoritish varianti:
 *  1) massa — bir-biriga kirishgan, har xil kattalikdagi bo'laklar (metaball), tagi deyarli tekis;
 *  2) yuza — 4 masshtabli Worley do'mboqlari ("gulkaram"): chetni mayda gumbazchalarga bo'ladi, ichida
 *     esa har bir gumbazchaga o'z soyasini beradi; ozgina fbm — momiq, yarim shaffof chet;
 *  3) yoritish — har nuqtadan yorug'lik tomonga 12 mayda qadam (Beer qonuni): gumbazchalarning quyosh
 *     tushgan tepasi oppoq, ostki tomoni va bulut tagi kulrang-ko'kimtir; osmondan kelgan tarqoq nur
 *     soyani butunlay qoraytirmaydi.
 */
function cloudSprites(seed: number): [HTMLCanvasElement, HTMLCanvasElement] {
  const W = 384;
  const H = 200;
  const r = rng(seed);
  const cells = makeWorley(seed * 29 + 1);
  const wisp = makeNoise(seed * 17 + 11);
  const warpX = makeNoise(seed * 7 + 3);
  const warpY = makeNoise(seed * 13 + 9);
  const aspect = W / H;

  // Massa: asos qatori + ustma-ust qavatlar; ba'zan yon tomonda kichik "dum" bo'lak
  const puffs: { x: number; y: number; rad: number }[] = [];
  const rows = [
    { n: 8 + Math.floor(r() * 4), y: 0.68, x0: 0.12, x1: 0.88, rad: 0.1 },
    { n: 5 + Math.floor(r() * 3), y: 0.56, x0: 0.2, x1: 0.8, rad: 0.11 },
    { n: 3 + Math.floor(r() * 3), y: 0.44, x0: 0.28, x1: 0.72, rad: 0.11 },
    { n: 1 + Math.floor(r() * 2), y: 0.33, x0: 0.38, x1: 0.62, rad: 0.1 },
  ];
  for (const row of rows) {
    const shift = (r() - 0.5) * 0.12; // qavatlar bir tomonga og'adi — nosimmetrik shakl
    for (let i = 0; i < row.n; i++) {
      const t = row.n === 1 ? 0.5 : i / (row.n - 1);
      const dome = Math.sin(t * Math.PI);
      puffs.push({
        x: lerp(row.x0, row.x1, t) + shift + (r() - 0.5) * 0.06,
        y: row.y - dome * 0.03 + (r() - 0.5) * 0.06,
        rad: row.rad * (0.65 + dome * 0.5 + r() * 0.35),
      });
    }
  }
  if (r() < 0.6) {
    const side = r() < 0.5 ? 0.1 : 0.9;
    puffs.push({ x: side, y: 0.7, rad: 0.05 + r() * 0.03 });
  }

  const dens = new Float32Array(W * H);
  const bumpMap = new Float32Array(W * H);
  for (let py = 0; py < H; py++) {
    const v = py / H;
    for (let px = 0; px < W; px++) {
      const u = px / W;
      const wu = u + (fbm(warpX, u * 4, v * 4, 2) - 0.5) * 0.07;
      const wv = v + (fbm(warpY, u * 4, v * 4, 2) - 0.5) * 0.07;
      let field = 0;
      for (const p of puffs) {
        const dy = (wv - p.y) / p.rad;
        if (dy > 2.4 || dy < -2.4) continue;
        const dx = ((wu - p.x) * aspect) / p.rad;
        if (dx > 2.4 || dx < -2.4) continue;
        field += Math.exp(-(dx * dx + dy * dy) * 1.3);
      }
      if (field < 0.1) continue;
      // Gulkaram: har masshtabda yumaloq do'mboqlar (katta → mayda)
      const x = wu * aspect;
      let bumps = 0;
      let amp = 0.5;
      let f = 5;
      for (let o = 0; o < 4; o++) {
        bumps += amp * (1 - Math.min(1, cells(x * f + o * 17, wv * f + o * 31) * 1.15)) ** 2;
        amp *= 0.5;
        f *= 2.1;
      }
      bumps /= 0.9375;
      const fluff = fbm(wisp, x * 26, wv * 26, 2);
      const mass = smoothstep(0.3, 1.5, field);
      let d = mass * 1.05 + (bumps - 0.32) * 1.1 * (1 - mass * 0.55) + (fluff - 0.5) * 0.14 - 0.05;
      // Tag: deyarli tekis, lekin chizg'ich bilan emas
      const baseLine = 0.8 + (fbm(wisp, u * 7, 3.3, 2) - 0.5) * 0.05;
      d *= smoothstep(baseLine + 0.05, baseLine - 0.07, v);
      d *=
        smoothstep(0, 0.06, u) * smoothstep(1, 0.94, u) * smoothstep(0, 0.07, v) * smoothstep(1, 0.93, v);
      dens[py * W + px] = clamp01(d);
      bumpMap[py * W + px] = bumps;
    }
  }
  const at = (x: number, y: number) => {
    const xi = x < 0 ? 0 : x > W - 1 ? W - 1 : x | 0;
    const yi = y < 0 ? 0 : y > H - 1 ? H - 1 : y | 0;
    return dens[yi * W + xi]!;
  };
  /** Yorug'lik tomonga yig'ilgan qalinlik: 12 mayda qadam (har gumbazcha o'zini soya qiladi). */
  const optical = (x: number, y: number, lx: number, ly: number) => {
    let tau = 0;
    for (let k = 1; k <= 12; k++) tau += at(x + lx * k * 2.2, y + ly * k * 2.2) * (k < 5 ? 1.3 : 0.8);
    return tau / 12;
  };

  const day = canvas(W, H);
  const warm = canvas(W, H);
  const dCtx = day.getContext('2d');
  const wCtx = warm.getContext('2d');
  if (!dCtx || !wCtx) return [day, warm];
  const dImg = dCtx.createImageData(W, H);
  const wImg = wCtx.createImageData(W, H);
  for (let py = 0; py < H; py++) {
    const v = py / H;
    for (let px = 0; px < W; px++) {
      const i = py * W + px;
      const d = dens[i]!;
      // Chet: zich joyda aniq, yupqa joyda momiq yarim shaffof
      const alpha = smoothstep(0.03, 0.34, d);
      if (alpha <= 0) continue;
      const o = i * 4;
      const thin = 1 - smoothstep(0.03, 0.4, d);
      const under = smoothstep(0.5, 0.82, v); // bulut tagi — soyada
      const bump = bumpMap[i]!;

      // Kunduz: quyosh yuqori-chapda; osmon nuri (ko'kimtir) soyani yumshatadi
      const lit = Math.exp(-optical(px, py, -0.45, -0.89) * 5.5);
      const light = clamp01(lit * 0.78 + 0.2 + thin * 0.25 + (bump - 0.3) * 0.25 - under * 0.2);
      let dc = mix([132, 142, 165], [206, 211, 222], smoothstep(0.05, 0.55, light));
      dc = mix(dc, WHITE, smoothstep(0.5, 0.92, light));
      dImg.data[o] = dc[0];
      dImg.data[o + 1] = dc[1];
      dImg.data[o + 2] = dc[2];
      dImg.data[o + 3] = alpha * 255;

      // Shom/tong: yorug'lik ufqdan — pastdan, chapdan
      const litW = Math.exp(-optical(px, py, -0.9, 0.42) * 5);
      const lightW = clamp01(litW * 0.9 + thin * 0.35 + (bump - 0.3) * 0.2 + under * 0.12);
      const shade = mix([58, 46, 88], [132, 84, 128], smoothstep(0, 0.5, lightW));
      const wc = mix(shade, [255, 184, 122], smoothstep(0.35, 0.95, lightW));
      wImg.data[o] = wc[0];
      wImg.data[o + 1] = wc[1];
      wImg.data[o + 2] = wc[2];
      wImg.data[o + 3] = alpha * 255;
    }
  }
  dCtx.putImageData(dImg, 0, 0);
  wCtx.putImageData(wImg, 0, 0);
  return [day, warm];
}

/** Patsimon (cirrus) bulutlar: shamolda cho'zilgan ingichka tolalar, x bo'yicha davriy. */
function cirrusSprites(): [HTMLCanvasElement, HTMLCanvasElement] {
  const W = 640;
  const H = 120;
  const noise = makeNoise(77);
  const warp = makeNoise(78);
  const period = 3;
  const day = canvas(W, H);
  const warm = canvas(W, H);
  const dCtx = day.getContext('2d');
  const wCtx = warm.getContext('2d');
  if (!dCtx || !wCtx) return [day, warm];
  const dImg = dCtx.createImageData(W, H);
  const wImg = wCtx.createImageData(W, H);
  for (let py = 0; py < H; py++) {
    const v = py / H;
    for (let px = 0; px < W; px++) {
      const u = (px / W) * period;
      const bend = (fbm(warp, u * 1.5, v * 2, 3, period * 1.5) - 0.5) * 0.5;
      // x bo'yicha kuchli cho'zilgan shovqin — tolalar
      const streak = fbm(noise, u * 2.2, (v + bend) * 7, 5, period * 2.2);
      const body = fbm(noise, u * 0.9 + 11, v * 2.2, 3, period * 0.9);
      const a =
        clamp01((streak - 0.42) * 1.8) * smoothstep(0.5, 0.72, body) * Math.sin(v * Math.PI) ** 1.5;
      const o = (py * W + px) * 4;
      dImg.data[o] = 248;
      dImg.data[o + 1] = 250;
      dImg.data[o + 2] = 255;
      dImg.data[o + 3] = a * 200;
      wImg.data[o] = 255;
      wImg.data[o + 1] = 170 + streak * 40;
      wImg.data[o + 2] = 150;
      wImg.data[o + 3] = a * 220;
    }
  }
  dCtx.putImageData(dImg, 0, 0);
  wCtx.putImageData(wImg, 0, 0);
  return [day, warm];
}

/**
 * Suv to'lqinlari: x bo'yicha kuchli cho'zilgan, davriy shovqin (kulrang 128 — neytral). `overlay`
 * bilan aks ustiga qo'yilganda to'lqin qiyaliklari osmonning yorug'/qorong'i qismini aks ettirgandek.
 */
function rippleSprite(): HTMLCanvasElement {
  const W = 512;
  const H = 96;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const img = ctx.createImageData(W, H);
  const noise = makeNoise(41);
  const period = 6;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const u = (px / W) * period;
      const v = (py / H) * 6;
      const n = fbm(noise, u, v * 2.2, 4, period);
      // Qirralar keskinroq — to'lqin cho'qqilari
      const g = clamp01(0.5 + (n - 0.5) * 2.4);
      const o = (py * W + px) * 4;
      const val = 128 + (g - 0.5) * 200;
      img.data[o] = val;
      img.data[o + 1] = val;
      img.data[o + 2] = val;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Oy: chekkasi qorong'iroq (limb darkening), "dengizlar" va kraterlar. */
function moonSprite(): HTMLCanvasElement {
  const S = 160;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const img = ctx.createImageData(S, S);
  const noise = makeNoise(91);
  const r = rng(91);
  const craters = Array.from({ length: 14 }, () => ({
    x: r() * 1.6 - 0.8,
    y: r() * 1.6 - 0.8,
    rad: 0.04 + r() * 0.1,
  }));
  const R = S * 0.46;
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const x = (px + 0.5 - S / 2) / R;
      const y = (py + 0.5 - S / 2) / R;
      const d = Math.hypot(x, y);
      if (d > 1.02) continue;
      const limb = Math.sqrt(Math.max(0, 1 - d * d));
      let b = 0.62 + 0.38 * limb ** 0.6;
      const maria = fbm(noise, x * 2.2 + 3, y * 2.2 + 3, 4);
      b -= smoothstep(0.5, 0.68, maria) * 0.22;
      for (const cr of craters) {
        const cd = Math.hypot(x - cr.x, y - cr.y) / cr.rad;
        if (cd < 1.15) b += cd < 0.85 ? -0.06 : 0.07 * (1 - Math.abs(cd - 1) * 6);
      }
      b += (fbm(noise, x * 9, y * 9, 2) - 0.5) * 0.08;
      const col = mix([196, 200, 214], [250, 250, 244], clamp01(b));
      const i = (py * S + px) * 4;
      img.data[i] = col[0];
      img.data[i + 1] = col[1];
      img.data[i + 2] = col[2];
      img.data[i + 3] = clamp01((1.02 - d) * 40) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Somon yo'li: diagonal xira yorug' tasma + chang (faqat tunda, juda past shaffoflikda). */
function milkyWaySprite(): HTMLCanvasElement {
  const W = 480;
  const H = 200;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const img = ctx.createImageData(W, H);
  const noise = makeNoise(57);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const u = px / W;
      const v = py / H;
      const dist = v - (0.85 - u * 0.75);
      const band = Math.exp(-((dist / 0.2) ** 2));
      const dust = fbm(noise, u * 9, v * 9, 5);
      const lane = 1 - smoothstep(0.55, 0.7, fbm(noise, u * 5 + 7, v * 5, 3)) * 0.6; // qorong'i chang yo'lagi
      const a = clamp01(band * smoothstep(0.35, 0.8, dust) * lane);
      const i = (py * W + px) * 4;
      img.data[i] = 196;
      img.data[i + 1] = 206;
      img.data[i + 2] = 255;
      img.data[i + 3] = a * 120;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Tuman: x bo'yicha davriy (chok yo'q), vertikal bo'yicha o'rtada qalin tasma. */
function mistSprite(): HTMLCanvasElement {
  const W = 512;
  const H = 96;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const img = ctx.createImageData(W, H);
  const noise = makeNoise(23);
  const period = 4;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const u = (px / W) * period;
      const v = py / H;
      const n = fbm(noise, u, v * 2.5, 5, period);
      const profile = Math.exp(-(((v - 0.55) / 0.26) ** 2));
      const a = clamp01((n - 0.32) * 1.9) * profile;
      const i = (py * W + px) * 4;
      img.data[i] = 226;
      img.data[i + 1] = 232;
      img.data[i + 2] = 246;
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Mayin donadorlik: gradientlardagi "zinapoya" chiziqlarini yashiradi (oq/qora, juda past shaffoflik). */
function grainSprite(): HTMLCanvasElement {
  const S = 128;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const img = ctx.createImageData(S, S);
  const r = rng(3);
  for (let i = 0; i < S * S; i++) {
    const g = r() < 0.5 ? 0 : 255;
    img.data[i * 4] = g;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = g;
    img.data[i * 4 + 3] = r() * 7;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Brauzerda teksturalarni yaratadi (bir marta, ~30–60 ms). Canvas bo'lmasa (jsdom) — null. */
export function createSceneTextures(): SceneTextures | null {
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) return null;
  const pairs = [0, 1, 2, 3, 4, 5].map((i) => cloudSprites(101 + i * 13));
  const [cirrusDay, cirrusWarm] = cirrusSprites();
  return {
    cloudsDay: pairs.map((p) => p[0]),
    cloudsWarm: pairs.map((p) => p[1]),
    cirrusDay,
    cirrusWarm,
    ripple: rippleSprite(),
    moon: moonSprite(),
    milkyWay: milkyWaySprite(),
    mist: mistSprite(),
    grain: grainSprite(),
    sky: canvas(1, 1),
    skySmall: canvas(1, 1),
  };
}

// --- Chizish ------------------------------------------------------------------------------------------

export interface DrawOptions {
  /** Soniyalarda — bo'sh turgandagi harakat (yulduz miltillashi, tuman, bulut, suv jilosi). */
  time: number;
  /** Tuman siljishi (hover'da tezlashadi). */
  mistOffset: number;
  /** Canvas piksel zichligi (devicePixelRatio). */
  dpr: number;
}

/** Quyosh diski: chiqish/botishda ufq bo'ylab biroz siljiydi; ufqda kattaroq, qizg'ish. */
function sunGeom(w: number, h: number, hy: number, s: SceneParams) {
  const alt = clamp01(s.sun);
  const r = Math.max(8, h * 0.055) * lerp(1.18, 1, smoothstep(0, 0.35, alt));
  return {
    x: w * lerp(0.24, 0.3, smoothstep(-0.1, 0.6, s.sun)),
    y: lerp(hy + r * 0.6, h * 0.2, s.sun),
    r,
    alt,
    visible: smoothstep(-0.14, 0.02, s.sun),
  };
}

/**
 * Oy: sharqdan (o'ngdan) qiya yo'l bilan ko'tariladi / shu yo'l bilan botadi. Ufq yonida kattaroq
 * ko'rinadi va havo qatlami orqali sarg'ish-to'q sariq tusga kiradi.
 */
function moonGeom(w: number, h: number, hy: number, s: SceneParams) {
  const alt = clamp01(s.moon);
  const r = Math.max(9, h * 0.07) * lerp(1.2, 1, smoothstep(0, 0.4, alt));
  return {
    x: w * lerp(0.86, 0.76, smoothstep(-0.2, 1, s.moon)),
    y: lerp(hy + r * 1.05, h * 0.25, s.moon),
    r,
    alt,
    // Shom paytida ham ko'rinadi (osmon hali yorug' — xiraroq), ufq ostida yashiringan
    visible: smoothstep(-0.16, 0.02, s.moon) * clamp01(0.35 + s.night * 0.75 + s.warmth * 0.2),
  };
}

function drawHills(
  ctx: CanvasRenderingContext2D,
  w: number,
  hy: number,
  heights: number[],
  maxH: number,
  color: string,
) {
  const step = w / (heights.length - 1);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, hy + 1);
  heights.forEach((v, i) => ctx.lineTo(i * step, hy - v * maxH));
  ctx.lineTo(w, hy + 1);
  ctx.closePath();
  ctx.fill();
}

/** Osmon qatlami (ufqqacha): gradient, yulduzlar, Somon yo'li, oy, quyosh, bulutlar, qirg'oq. */
function drawSky(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  hy: number,
  s: SceneParams,
  a: SceneAssets,
  tx: SceneTextures | null,
  time: number,
) {
  const day = 1 - s.night;

  // Atmosfera: zenit → o'rta → ufq, ufq yonida oqish havo qatlami
  const g = ctx.createLinearGradient(0, 0, 0, hy);
  g.addColorStop(0, rgba(s.sky.top));
  g.addColorStop(0.38, rgba(mix(s.sky.top, s.sky.mid, 0.6)));
  g.addColorStop(0.72, rgba(s.sky.mid));
  g.addColorStop(0.93, rgba(s.sky.horizon));
  g.addColorStop(1, rgba(mix(s.sky.horizon, WHITE, 0.12 * day + 0.04)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, hy);

  // Shom/tongda quyosh tomonda ufq yonib turadi
  if (s.warmth > 0.01) {
    const glow = ctx.createRadialGradient(w * 0.3, hy, 0, w * 0.3, hy, w * 0.75);
    glow.addColorStop(0, rgba([255, 168, 92], 0.55 * s.warmth));
    glow.addColorStop(0.45, rgba([255, 120, 110], 0.18 * s.warmth));
    glow.addColorStop(1, rgba([255, 120, 110], 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, hy);
  }

  // Somon yo'li va yulduzlar
  if (s.night > 0.01) {
    if (tx) {
      ctx.globalAlpha = s.night * 0.75;
      ctx.drawImage(tx.milkyWay, 0, 0, w, hy);
      ctx.globalAlpha = 1;
    }
    for (const st of a.stars) {
      const tw = 0.6 + 0.4 * Math.sin(time * st.speed + st.phase);
      // Ufqqa yaqin yulduzlar havo qatlami tufayli xiraroq
      const alpha = s.night * tw * (0.35 + 0.65 * (1 - st.y));
      const x = st.x * w;
      const y = st.y * hy;
      if (st.r > 1.05) {
        const halo = ctx.createRadialGradient(x, y, 0, x, y, st.r * 4);
        halo.addColorStop(0, rgba(st.color, alpha * 0.5));
        halo.addColorStop(1, rgba(st.color, 0));
        ctx.fillStyle = halo;
        ctx.fillRect(x - st.r * 4, y - st.r * 4, st.r * 8, st.r * 8);
      }
      ctx.fillStyle = rgba(st.color, alpha);
      if (st.r > 0.8) {
        ctx.beginPath();
        ctx.arc(x, y, st.r * 0.75, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Mayda yulduz — kvadrat piksel yetarli (doira chizishdan ancha arzon)
        const d = st.r * 1.3;
        ctx.fillRect(x - d / 2, y - d / 2, d, d);
      }
    }
  }

  // Oy: keng xira halo + teksturali disk; ufq yonida iliq tus (havo qatlami ko'k nurni yutadi)
  const mg = moonGeom(w, h, hy, s);
  if (mg.visible > 0.01) {
    const { x: mx, y: my, r: mr } = mg;
    const low = 1 - smoothstep(0, 0.45, mg.alt);
    const haloTint = mix([200, 210, 255], [255, 206, 160], low);
    const halo = ctx.createRadialGradient(mx, my, mr * 0.9, mx, my, mr * 7);
    halo.addColorStop(0, rgba(haloTint, 0.3 * mg.visible * s.night + 0.06 * mg.visible));
    halo.addColorStop(0.35, rgba(haloTint, 0.09 * mg.visible * s.night));
    halo.addColorStop(1, rgba(haloTint, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(mx - mr * 7, my - mr * 7, mr * 14, mr * 14);
    ctx.globalAlpha = mg.visible;
    if (tx)
      ctx.drawImage(tx.moon, mx - mr / 0.92, my - mr / 0.92, (mr * 2) / 0.92, (mr * 2) / 0.92);
    else {
      ctx.fillStyle = rgba(MOON);
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.fill();
    }
    if (low > 0.02) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = mg.visible * low * 0.85;
      ctx.fillStyle = rgba([255, 196, 132]);
      ctx.beginPath();
      ctx.arc(mx, my, mr * 1.01, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  // Quyosh: keng atmosfera nuri (Mie sochilishi), yorqin halo, oq-issiq yadro; ufqda yassi va qizg'ish
  const sg = sunGeom(w, h, hy, s);
  if (sg.visible > 0.01) {
    const { x: sx, y: sy, r: sr, alt } = sg;
    const tint = mix([255, 128, 56], [255, 240, 210], smoothstep(0, 0.55, alt));
    const wide = ctx.createRadialGradient(
      sx,
      sy,
      0,
      sx,
      sy,
      Math.max(w, h) * lerp(0.75, 0.55, alt),
    );
    wide.addColorStop(0, rgba(tint, 0.42 * sg.visible));
    wide.addColorStop(0.12, rgba(tint, 0.2 * sg.visible));
    wide.addColorStop(0.4, rgba(tint, 0.06 * sg.visible));
    wide.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = wide;
    ctx.fillRect(0, 0, w, hy);
    const bloom = ctx.createRadialGradient(sx, sy, sr * 0.6, sx, sy, sr * 3.2);
    bloom.addColorStop(0, rgba(mix(tint, WHITE, 0.7), 0.85 * sg.visible));
    bloom.addColorStop(0.3, rgba(mix(tint, WHITE, 0.35), 0.35 * sg.visible));
    bloom.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = bloom;
    ctx.fillRect(sx - sr * 3.3, sy - sr * 3.3, sr * 6.6, sr * 6.6);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(1, lerp(0.84, 1, smoothstep(0, 0.25, alt)));
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, sr);
    core.addColorStop(0, rgba([255, 255, 252], sg.visible));
    core.addColorStop(0.82, rgba(mix(tint, WHITE, 0.75), sg.visible));
    core.addColorStop(1, rgba(mix(tint, WHITE, 0.5), 0));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, sr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Baland patsimon bulutlar: juda sekin suzadi; shomda pushti-oltin
  const cloudAlpha = clamp01(day * 1.2 - 0.05);
  if (tx && cloudAlpha > 0.01) {
    const cw = w * 1.4;
    const ch = hy * 0.42;
    const off = -((time * 0.0016 * w) % cw);
    for (const k of [0, 1]) {
      const x = off + k * cw;
      ctx.globalAlpha = cloudAlpha * 0.55 * (1 - s.warmth);
      ctx.drawImage(tx.cirrusDay, x, hy * 0.02, cw, ch);
      if (s.warmth > 0.01) {
        ctx.globalAlpha = cloudAlpha * 0.75 * s.warmth;
        ctx.drawImage(tx.cirrusWarm, x, hy * 0.02, cw, ch);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Kumulus bulutlar: yaqinlari tepada va katta; uzoqlari ufq yonida, havo pardasi ortida xira
  if (tx && cloudAlpha > 0.01) {
    for (const c of a.clouds) {
      const cw = c.width * h;
      const ch = cw * 0.5;
      const span = w + cw * 1.2;
      const x = ((((c.x * span + time * c.speed * w) % span) + span) % span) - cw * 0.6;
      const y = c.y * hy - ch * 0.62;
      const fade = cloudAlpha * (1 - c.depth * 0.3);
      ctx.globalAlpha = fade * (1 - s.warmth);
      ctx.drawImage(tx.cloudsDay[c.sprite]!, x, y, cw, ch);
      if (s.warmth > 0.01) {
        ctx.globalAlpha = fade * s.warmth;
        ctx.drawImage(tx.cloudsWarm[c.sprite]!, x, y, cw, ch);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Havo perspektivasi: ufq yonida osmon rangidagi parda (uzoq bulut va tepaliklarni yumshatadi)
  const haze = ctx.createLinearGradient(0, hy * 0.55, 0, hy);
  haze.addColorStop(0, rgba(s.sky.horizon, 0));
  haze.addColorStop(1, rgba(mix(s.sky.horizon, WHITE, 0.1 * day), 0.5 * day + 0.15));
  ctx.fillStyle = haze;
  ctx.fillRect(0, hy * 0.55, w, hy * 0.45);

  // Qirg'oq: uzoq qatlam havoda xiralashgan, yaqinrog'i to'qroq (havo perspektivasi)
  const far = mix(s.sky.horizon, s.sky.top, 0.35);
  drawHills(ctx, w, hy, a.farHills, h * 0.05, rgba(mix(far, [10, 14, 30], 0.35 + 0.25 * s.night)));
  drawHills(
    ctx,
    w,
    hy,
    a.nearHills,
    h * 0.028,
    rgba(mix(s.sky.horizon, [6, 9, 20], 0.62 + 0.25 * s.night)),
  );
}

/**
 * Butun sahna: osmon alohida bufferga chiziladi, so'ng suvga to'lqin bilan buzilgan ko'zgu aksi
 * sifatida qator-qator ko'chiriladi (ranglar o'tish bo'yi osmonga ergashadi). Ustidan — quyosh/oy
 * yo'lidagi yaltirash, tuman qatlamlari, vinyetka va donadorlik.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  s: SceneParams,
  a: SceneAssets,
  { time, mistOffset, dpr }: DrawOptions,
): void {
  const hy = Math.round(h * 0.66);
  const waterH = h - hy;
  const tx = a.textures;
  const day = 1 - s.night;

  // 1) Osmon → bufer (bo'lmasa to'g'ridan-to'g'ri)
  let skyCtx = ctx;
  if (tx) {
    const bw = Math.round(w * dpr);
    const bh = Math.round(hy * dpr);
    if (tx.sky.width !== bw || tx.sky.height !== bh) {
      tx.sky.width = bw;
      tx.sky.height = bh;
    }
    skyCtx = tx.sky.getContext('2d') ?? ctx;
    skyCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  drawSky(skyCtx, w, h, hy, s, a, tx, time);
  if (tx) ctx.drawImage(tx.sky, 0, 0, w, hy);

  // 2) Suv: ko'zgu aksi kichraytirilgan osmondan (tabiiy xiralik); pastga — kameraga yaqin suv —
  //    to'lqin kattaroq. Qatorlar 1px: aks "zinapoya" bo'lib ko'rinmaydi.
  ctx.fillStyle = rgba(mix(s.sky.top, [0, 0, 0], 0.5));
  ctx.fillRect(0, hy, w, waterH);
  if (tx) {
    const small = tx.skySmall;
    const sw = Math.max(1, Math.round(w / 3));
    const sh = Math.max(1, Math.round(hy / 3));
    if (small.width !== sw || small.height !== sh) {
      small.width = sw;
      small.height = sh;
    }
    const sctx = small.getContext('2d');
    if (sctx) {
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(tx.sky, 0, 0, sw, sh);
      ctx.imageSmoothingQuality = 'high';
      const k = sh / hy;
      for (let y = 0; y < waterH; y += 1) {
        const depth = y / waterH;
        const amp = 0.3 + depth * depth * 3.2;
        const dx =
          Math.sin(y * 0.5 - time * 1.6) * amp + Math.sin(y * 0.13 + time * 0.7) * amp * 0.7;
        const sy = Math.max(0, (hy - y - 1) * k);
        ctx.drawImage(small, 0, sy, sw, Math.max(0.5, k), dx - 4, hy + y, w + 8, 1.2);
      }
    }
  }
  // To'lqinlar: perspektivada — ufqda mayda va zich, kameraga yaqin yirik; sekin suzadi
  if (tx) {
    tx.ripplePattern ??= ctx.createPattern(tx.ripple, 'repeat');
    const pattern = tx.ripplePattern;
    if (pattern) {
      ctx.globalCompositeOperation = 'overlay';
      const bands = 14;
      for (let i = 0; i < bands; i++) {
        const t0 = (i / bands) ** 1.7;
        const t1 = ((i + 1) / bands) ** 1.7;
        const y0 = hy + t0 * waterH;
        const y1 = hy + t1 * waterH + 1;
        const depth = (t0 + t1) / 2;
        const scale = 0.18 + depth * 1.5;
        pattern.setTransform(
          new DOMMatrix()
            .translateSelf((time * (6 + depth * 22)) % (tx.ripple.width * scale), y0)
            .scaleSelf(scale, scale * 0.55),
        );
        ctx.globalAlpha = (0.22 + 0.35 * day) * (0.55 + depth * 0.45);
        ctx.fillStyle = pattern;
        ctx.fillRect(0, y0, w, y1 - y0);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }

  // Fresnel: ufq yonida aks kuchli, yaqin suv chuqur va qorong'iroq (kunduzi zangori-ko'k ko'l)
  const deep = mix(mix(s.sky.top, [2, 6, 18], 0.55), [8, 52, 86], day * 0.65);
  const fres = ctx.createLinearGradient(0, hy, 0, h);
  fres.addColorStop(0, rgba(deep, 0.12));
  fres.addColorStop(0.5, rgba(deep, 0.35));
  fres.addColorStop(1, rgba(deep, 0.62));
  ctx.fillStyle = fres;
  ctx.fillRect(0, hy, w, waterH);
  // Ufq chizig'idagi nozik yorug' chiziq (uzoq suv yuzasi)
  ctx.fillStyle = rgba(mix(s.sky.horizon, WHITE, 0.4), 0.35);
  ctx.fillRect(0, hy, w, 1);

  // Mayda to'lqin yaltirashlari
  const ripple = mix([150, 170, 230], WHITE, day);
  for (let i = 0; i < 46; i++) {
    const seed = i * 12.9898;
    const yy = hy + 3 + ((((Math.sin(seed) * 43758.5453) % 1) + 1) % 1) * (waterH - 4);
    const xx = (((((Math.cos(seed) * 24634.6345) % 1) + 1) % 1) + time * 0.006) % 1;
    const len = (0.015 + ((i * 7) % 11) / 260) * w * (0.4 + (yy - hy) / waterH);
    const al = (0.025 + 0.04 * day) * (0.5 + 0.5 * Math.sin(time * 1.1 + i));
    ctx.fillStyle = rgba(ripple, al);
    ctx.fillRect(xx * w, yy, len, 1);
  }

  // 3) Quyosh/oy yo'li: suvda titrab turuvchi yaltirash uchqunlari
  const paths: { x: number; color: Rgb; strength: number; width: number }[] = [];
  const sg = sunGeom(w, h, hy, s);
  const sunVisible = sg.visible * smoothstep(-0.02, 0.06, s.sun);
  if (sunVisible > 0.01)
    paths.push({
      x: sg.x,
      color: mix([255, 150, 70], [255, 250, 232], smoothstep(0, 0.5, sg.alt)),
      strength: sunVisible * lerp(1, 0.75, sg.alt),
      // Quyosh baland — yo'l keng va siyrak; past — tor va zich
      width: h * lerp(0.12, 0.24, sg.alt),
    });
  const mg = moonGeom(w, h, hy, s);
  const moonVisible = mg.visible * smoothstep(-0.02, 0.08, s.moon);
  if (moonVisible > 0.01)
    paths.push({
      x: mg.x,
      color: mix([255, 206, 150], MOON, smoothstep(0, 0.45, mg.alt)),
      strength: moonVisible * 0.7,
      width: h * 0.12,
    });
  const tick = Math.floor(time * 14);
  ctx.globalCompositeOperation = 'lighter';
  for (const p of paths) {
    // Yumshoq nur ustuni (aks), ufqda tor, kameraga yaqinlashgan sari kengayadi
    ctx.save();
    ctx.translate(p.x, hy);
    ctx.scale(1, (waterH / p.width) * 1.6);
    const col = ctx.createRadialGradient(0, 0, 0, 0, 0, p.width * 0.75);
    col.addColorStop(0, rgba(p.color, 0.28 * p.strength));
    col.addColorStop(1, rgba(p.color, 0));
    ctx.fillStyle = col;
    ctx.fillRect(-p.width, 0, p.width * 2, p.width);
    ctx.restore();
    // Yaltirash uchqunlari: mayda, har xil uzunlikda, har kadrda o'rnini o'zgartiradi
    for (let i = 0; i < 140; i++) {
      const k = Math.sin((i + 1) * 78.233 + tick * 0.37) * 43758.5453;
      const rnd = k - Math.floor(k);
      const k2 = Math.sin((i + 1) * 12.989 + tick * 0.73) * 24634.634;
      const rnd2 = k2 - Math.floor(k2);
      const depth = ((i * 0.618) % 1) ** 1.3;
      const y = hy + 1.5 + depth * (waterH - 3);
      const spread = p.width * (0.15 + depth * 0.85);
      const x = p.x + (rnd - 0.5) * spread * (0.6 + rnd2 * 0.8);
      const len = 1 + rnd2 * rnd2 * (2 + depth * 7);
      ctx.fillStyle = rgba(p.color, p.strength * rnd2 * (1 - depth * 0.5) * 0.9);
      ctx.fillRect(x - len / 2, y, len, 1);
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  // 4) Tuman: ikki qatlam, har xil tezlik (parallaks); tunda qalin, kunduzi yupqa havo
  if (tx) {
    const amount = lerp(0.1, 0.95, s.night) + s.warmth * 0.15;
    const layers = [
      { y: hy - h * 0.1, hgt: h * 0.32, speed: 0.012, alpha: 0.55, scale: 1.4 },
      { y: hy - h * 0.02, hgt: h * 0.26, speed: 0.022, alpha: 0.7, scale: 1 },
    ];
    for (const l of layers) {
      // Pattern — tayyorlangan teksturani choksiz takrorlaydi (ustma-ust tushgan chiziq bo'lmaydi)
      const pattern = ctx.createPattern(tx.mist, 'repeat-x');
      if (!pattern) continue;
      const tileW = w * l.scale;
      const off = -((mistOffset * l.speed * w) % tileW);
      pattern.setTransform(
        new DOMMatrix()
          .translateSelf(off, l.y)
          .scaleSelf(tileW / tx.mist.width, l.hgt / tx.mist.height),
      );
      ctx.globalAlpha = clamp01(amount * l.alpha);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, l.y, w, l.hgt);
    }
    ctx.globalAlpha = 1;
  }

  // 5) Vinyetka va donadorlik (kinematografik yakun, gradient chiziqlarisiz)
  const vig = ctx.createRadialGradient(
    w / 2,
    h * 0.55,
    h * 0.3,
    w / 2,
    h * 0.55,
    Math.max(w, h) * 0.75,
  );
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, rgba([0, 0, 0], 0.32));
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
  if (tx) {
    tx.grainPattern ??= ctx.createPattern(tx.grain, 'repeat');
    if (tx.grainPattern) {
      ctx.fillStyle = tx.grainPattern;
      ctx.fillRect(0, 0, w, h);
    }
  }
}
