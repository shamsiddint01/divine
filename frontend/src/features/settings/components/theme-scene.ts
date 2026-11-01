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
}

export function sceneParams({ dir, p, direct }: SceneState): SceneParams {
  const sky = skyAt((direct ? DIRECT_KEYS : KEYS)[dir], p);
  if (direct) {
    const day = dir === 'toDay' ? p : 1 - p;
    return { sky, night: 1 - day, warmth: 0, sun: day > 0.5 ? 1 : -1 };
  }
  if (dir === 'toDay') {
    return {
      sky,
      night: 1 - smoothstep(0.2, 0.62, p),
      warmth: bell(p, 0.62, 0.17),
      // Quyosh tong oldidan keyin ufqdan ko'tariladi
      sun: lerp(-0.12, 1, 1 - (1 - smoothstep(0.38, 1, p)) ** 3),
    };
  }
  return {
    sky,
    night: smoothstep(0.62, 0.95, p),
    warmth: bell(p, 0.6, 0.17),
    // Quyosh shomgacha ufqqa tushadi va uning ortiga botadi
    sun: lerp(1, -0.15, smoothstep(0, 0.74, p) ** 1.6),
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
  const clouds = [
    { x: 0.02, y: 0.22, width: 1.55, speed: 0.0045, sprite: 0 },
    { x: 0.34, y: 0.42, width: 1.05, speed: 0.006, sprite: 1 },
    { x: 0.58, y: 0.16, width: 1.85, speed: 0.0038, sprite: 2 },
    { x: 0.86, y: 0.5, width: 0.85, speed: 0.0068, sprite: 3 },
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
  /** Kunduzgi (oq, pastki qismi kulrang-ko'kish soyada) va shom (pastdan iliq yoritilgan) bulutlar. */
  cloudsDay: HTMLCanvasElement[];
  cloudsWarm: HTMLCanvasElement[];
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
 * Kumulus bulut, ikki yoritish varianti. Uch bosqich:
 *  1) shakl — "egiltirilgan" (domain warp) koordinatalarda bir nechta gumbaz; tagi tekis;
 *  2) zichlik — chetlari fbm bilan yemiriladi, tekstura chegarasida yumshoq so'nadi (to'rtburchak yo'q);
 *  3) hajmli yoritish — nuqtadan yorug'lik manbaigacha bo'lgan bulut qalinligi yig'iladi:
 *     kunduzi yorug'lik tepadan (tepasi oq, tagi kulrang), shomda — ufqdan, pastdan (tagi oltin).
 */
function cloudSprites(seed: number): [HTMLCanvasElement, HTMLCanvasElement] {
  const W = 360;
  const H = 170;
  const r = rng(seed);
  const shape = makeNoise(seed * 31 + 5);
  const erode = makeNoise(seed * 17 + 11);
  const warpX = makeNoise(seed * 7 + 3);
  const warpY = makeNoise(seed * 13 + 9);
  const aspect = W / H;

  // Asos qatori — keng, past gumbazlar; o'rtada balandroq "minoralar"
  const puffs: { x: number; y: number; rad: number }[] = [];
  const base = 5 + Math.floor(r() * 3);
  for (let i = 0; i < base; i++) {
    const t = i / (base - 1);
    puffs.push({ x: 0.17 + t * 0.66 + (r() - 0.5) * 0.04, y: 0.64, rad: 0.2 + r() * 0.08 });
  }
  const towers = 3 + Math.floor(r() * 3);
  for (let i = 0; i < towers; i++) {
    const t = 0.3 + r() * 0.4;
    puffs.push({ x: t, y: 0.46 - r() * 0.1, rad: 0.17 + r() * 0.08 });
  }

  const dens = new Float32Array(W * H);
  // "Gulkaram" bo'laklari: ichki yoritishni modulyatsiya qiladi (silliq plastik emas)
  const lobes = new Float32Array(W * H);
  for (let py = 0; py < H; py++) {
    const v = py / H;
    for (let px = 0; px < W; px++) {
      const u = px / W;
      const wu = u + (fbm(warpX, u * 3, v * 3, 3) - 0.5) * 0.12;
      const wv = v + (fbm(warpY, u * 3, v * 3, 3) - 0.5) * 0.12;
      // Metaball: bo'laklar silliq qo'shilib yaxlit tana hosil qiladi (alohida sharlar emas)
      let field = 0;
      for (const p of puffs) {
        const d = Math.hypot((wu - p.x) * aspect, wv - p.y) / p.rad;
        field += Math.exp(-d * d * 1.6);
      }
      let m = smoothstep(0.3, 1.05, field);
      m *= smoothstep(0.84, 0.7, v); // tekis tag
      const billow = fbm(shape, u * 6.5 * aspect, v * 6.5, 5);
      const fine = fbm(erode, u * 16 * aspect, v * 16, 3);
      // Chet — notekis bo'lakli kontur; ichki qism yaxlit qoladi
      let d = m * 1.2 - (1 - billow) * 0.5 * (1 - m * 0.55) - (1 - fine) * 0.08 + 0.1;
      lobes[py * W + px] = billow * 0.75 + fine * 0.25;
      // Tekstura chetida majburiy so'nish
      d *=
        smoothstep(0, 0.1, u) *
        smoothstep(1, 0.9, u) *
        smoothstep(0, 0.12, v) *
        smoothstep(1, 0.92, v);
      dens[py * W + px] = clamp01(d);
    }
  }

  const day = canvas(W, H);
  const warm = canvas(W, H);
  const dCtx = day.getContext('2d');
  const wCtx = warm.getContext('2d');
  if (!dCtx || !wCtx) return [day, warm];
  const dImg = dCtx.createImageData(W, H);
  const wImg = wCtx.createImageData(W, H);
  const step = 1 / H;
  for (let px = 0; px < W; px++) {
    // Tepadan pastga: nuqtagacha yig'ilgan qalinlik (kunduzgi yorug'lik tepadan)
    let fromTop = 0;
    const topAcc = new Float32Array(H);
    for (let py = 0; py < H; py++) {
      topAcc[py] = fromTop;
      fromTop += dens[py * W + px]! * step;
    }
    // Pastdan tepaga: shom/tongda yorug'lik ufqdan
    let fromBottom = 0;
    for (let py = H - 1; py >= 0; py--) {
      const i = py * W + px;
      const d = dens[i]!;
      const alpha = smoothstep(0.08, 0.27, d);
      const o = i * 4;
      if (alpha > 0) {
        const edge = 1 - smoothstep(0.08, 0.3, d); // yupqa chet — nur o'tadi ("kumush chet")
        const lobe = 0.86 + (lobes[i]! - 0.45) * 0.95; // bo'lak tepasi yorug', orasidagi chuqurlik soyada
        const lightDay = clamp01((Math.exp(-topAcc[py]! * 7) * 0.82 + 0.16) * lobe + edge * 0.3);
        const dc = mix([148, 160, 186], [255, 255, 255], lightDay);
        dImg.data[o] = dc[0];
        dImg.data[o + 1] = dc[1];
        dImg.data[o + 2] = dc[2];
        dImg.data[o + 3] = alpha * 255;

        const lightWarm = clamp01(Math.exp(-fromBottom * 7) * 0.95 * lobe + edge * 0.4);
        const shade = mix([70, 56, 98], [150, 96, 140], clamp01(lightWarm * 1.6));
        const wc = mix(shade, [255, 190, 132], clamp01(lightWarm ** 1.4 * 1.1));
        wImg.data[o] = wc[0];
        wImg.data[o + 1] = wc[1];
        wImg.data[o + 2] = wc[2];
        wImg.data[o + 3] = alpha * 255;
      }
      fromBottom += d * step;
    }
  }
  dCtx.putImageData(dImg, 0, 0);
  wCtx.putImageData(wImg, 0, 0);
  return [day, warm];
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
    img.data[i * 4 + 3] = r() * 22;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Brauzerda teksturalarni yaratadi (bir marta, ~30–60 ms). Canvas bo'lmasa (jsdom) — null. */
export function createSceneTextures(): SceneTextures | null {
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) return null;
  const pairs = [0, 1, 2, 3].map((i) => cloudSprites(101 + i * 13));
  return {
    cloudsDay: pairs.map((p) => p[0]),
    cloudsWarm: pairs.map((p) => p[1]),
    moon: moonSprite(),
    milkyWay: milkyWaySprite(),
    mist: mistSprite(),
    grain: grainSprite(),
    sky: canvas(1, 1),
    skySmall: canvas(1, 1),
  };
}

// --- Chizish ------------------------------------------------------------------------------------------
const WHITE: Rgb = [255, 255, 255];
const MOON: Rgb = [236, 238, 255];

export interface DrawOptions {
  /** Soniyalarda — bo'sh turgandagi harakat (yulduz miltillashi, tuman, bulut, suv jilosi). */
  time: number;
  /** Tuman siljishi (hover'da tezlashadi). */
  mistOffset: number;
  /** Canvas piksel zichligi (devicePixelRatio). */
  dpr: number;
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

  // Oy: keng xira halo + teksturali disk
  if (s.night > 0.01) {
    const mx = w * 0.76;
    const my = h * 0.25;
    const mr = Math.max(9, h * 0.075);
    const halo = ctx.createRadialGradient(mx, my, mr * 0.9, mx, my, mr * 7);
    halo.addColorStop(0, rgba([200, 210, 255], 0.3 * s.night));
    halo.addColorStop(0.35, rgba([170, 185, 245], 0.09 * s.night));
    halo.addColorStop(1, rgba([170, 185, 245], 0));
    ctx.fillStyle = halo;
    ctx.fillRect(mx - mr * 7, my - mr * 7, mr * 14, mr * 14);
    ctx.globalAlpha = s.night;
    if (tx)
      ctx.drawImage(tx.moon, mx - mr / 0.92, my - mr / 0.92, (mr * 2) / 0.92, (mr * 2) / 0.92);
    else {
      ctx.fillStyle = rgba(MOON);
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Quyosh: oq-issiq yadro, yorqin halo, keng atmosfera nuri (ufqda to'q sariq va kattaroq)
  const sunVisible = smoothstep(-0.12, 0.04, s.sun);
  if (sunVisible > 0.01) {
    const alt = clamp01(s.sun);
    const sx = w * 0.3;
    const sr = Math.max(8, h * 0.06);
    const sy = lerp(hy + sr * 0.5, h * 0.2, s.sun);
    const tint = mix([255, 150, 70], [255, 244, 214], alt);
    const wide = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * lerp(14, 9, alt));
    wide.addColorStop(0, rgba(tint, 0.45 * sunVisible));
    wide.addColorStop(0.25, rgba(tint, 0.16 * sunVisible));
    wide.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = wide;
    ctx.fillRect(0, 0, w, hy);
    const core = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 1.25);
    core.addColorStop(0, rgba([255, 255, 250], sunVisible));
    core.addColorStop(0.7, rgba(mix(tint, WHITE, 0.6), sunVisible));
    core.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = core;
    ctx.fillRect(sx - sr * 1.3, sy - sr * 1.3, sr * 2.6, sr * 2.6);
  }

  // Bulutlar: kunduzgi va iliq variantlar shom/tongda aralashadi; tunda deyarli ko'rinmaydi
  const cloudAlpha = clamp01(day * 1.2 - 0.05);
  if (tx && cloudAlpha > 0.01) {
    for (const c of a.clouds) {
      const cw = c.width * h;
      const ch = cw * (170 / 360);
      const span = w + cw * 1.2;
      const x = ((((c.x * span + time * c.speed * w) % span) + span) % span) - cw * 0.6;
      const y = c.y * hy - ch * 0.55;
      ctx.globalAlpha = cloudAlpha * (1 - s.warmth);
      ctx.drawImage(tx.cloudsDay[c.sprite]!, x, y, cw, ch);
      if (s.warmth > 0.01) {
        ctx.globalAlpha = cloudAlpha * s.warmth;
        ctx.drawImage(tx.cloudsWarm[c.sprite]!, x, y, cw, ch);
      }
    }
    ctx.globalAlpha = 1;
  }

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

  const __t: number[] = [];
  const __mark = (i: number) => (__t[i] = performance.now());
  __mark(0);
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

  __mark(1);
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
  __mark(2);
  // Fresnel: ufq yonida aks kuchli, yaqin suv chuqur va qorong'iroq
  const deep = mix(s.sky.top, [2, 6, 18], 0.55);
  const fres = ctx.createLinearGradient(0, hy, 0, h);
  fres.addColorStop(0, rgba(deep, 0.12));
  fres.addColorStop(0.5, rgba(deep, 0.35));
  fres.addColorStop(1, rgba(deep, 0.62));
  ctx.fillStyle = fres;
  ctx.fillRect(0, hy, w, waterH);
  // Ufq chizig'idagi nozik yorug' chiziq (uzoq suv yuzasi)
  ctx.fillStyle = rgba(mix(s.sky.horizon, WHITE, 0.4), 0.35);
  ctx.fillRect(0, hy, w, 1);

  __mark(3);
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

  __mark(4);
  // 3) Quyosh/oy yo'li: suvda titrab turuvchi yaltirash uchqunlari
  const paths: { x: number; color: Rgb; strength: number; width: number }[] = [];
  const sunVisible = smoothstep(-0.12, 0.04, s.sun);
  if (sunVisible > 0.01)
    paths.push({
      x: w * 0.3,
      color: mix([255, 168, 90], [255, 250, 232], clamp01(s.sun)),
      strength: sunVisible * lerp(1, 0.6, clamp01(s.sun)),
      width: h * 0.16,
    });
  if (s.night > 0.01)
    paths.push({ x: w * 0.76, color: MOON, strength: s.night * 0.7, width: h * 0.12 });
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
    for (let i = 0; i < 90; i++) {
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

  __mark(5);
  // 4) Tuman: ikki qatlam, har xil tezlik (parallaks); tunda qalin, kunduzi yupqa havo
  if (tx) {
    const amount = lerp(0.22, 0.95, s.night) + s.warmth * 0.15;
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

  __mark(6);
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
  __mark(7);
  const g = globalThis as unknown as { __prof?: number[][] };
  (g.__prof ??= []).push(__t.slice(1).map((v, k) => v - __t[k]!));
}
