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

