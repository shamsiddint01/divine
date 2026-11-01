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
const NIGHT: Sky = { top: [5, 7, 22], mid: [12, 16, 44], horizon: [36, 36, 84] };
const PREDAWN: Sky = { top: [24, 20, 64], mid: [80, 52, 124], horizon: [176, 110, 162] };
const SUNRISE: Sky = { top: [62, 100, 176], mid: [214, 152, 142], horizon: [255, 198, 120] };
const DAY: Sky = { top: [28, 112, 222], mid: [88, 162, 238], horizon: [196, 226, 250] };
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

// --- Sahna "aktivlari": tasodifiy, lekin har safar bir xil (o'lchamga nisbiy) -----------------------
interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
  speed: number;
}
interface Puff {
  dx: number;
  dy: number;
  r: number;
}
interface Cloud {
  x: number;
  y: number;
  scale: number;
  speed: number;
  puffs: Puff[];
}
interface Streak {
  y: number;
  x: number;
  len: number;
  phase: number;
}
export interface SceneAssets {
  stars: Star[];
  clouds: Cloud[];
  streaks: Streak[];
  shore: number[];
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function createSceneAssets(seed = 7): SceneAssets {
  const r = rng(seed);
  const stars = Array.from({ length: 140 }, () => ({
    x: r(),
    y: r() ** 1.4 * 0.92, // tepada zichroq
    r: 0.4 + r() * 1.1,
    phase: r() * Math.PI * 2,
    speed: 0.6 + r() * 1.8,
  }));
  const clouds = Array.from({ length: 6 }, (_, i) => ({
    x: i / 6 + r() * 0.1,
    y: 0.12 + r() * 0.32,
    scale: 0.7 + r() * 0.6,
    speed: 0.004 + r() * 0.006,
    puffs: Array.from({ length: 5 + Math.floor(r() * 3) }, (_, k) => ({
      dx: (k - 3) * 0.032 + (r() - 0.5) * 0.02,
      dy: (r() - 0.5) * 0.05 - Math.abs(k - 3) * 0.006,
      r: 0.05 + r() * 0.035,
    })),
  }));
  const streaks = Array.from({ length: 34 }, () => ({
    y: r(),
    x: r(),
    len: 0.04 + r() * 0.16,
    phase: r() * Math.PI * 2,
  }));
  // Uzoq qirg'oq: past, yumshoq tepaliklar (ufq ustida juda kichik)
  const shore = Array.from({ length: 33 }, (_, i) => {
    const t = i / 32;
    return 0.35 + 0.35 * Math.sin(t * 7.1 + 1.3) * Math.sin(t * 2.3) + 0.3 * r();
  });
  return { stars, clouds, streaks, shore };
}

// --- Chizish ------------------------------------------------------------------------------------------
const WHITE: Rgb = [255, 255, 255];
const WARM: Rgb = [255, 172, 120];
const MOON: Rgb = [236, 238, 255];

export interface DrawOptions {
  /** Soniyalarda — bo'sh turgandagi harakat (yulduz miltillashi, tuman, bulut, suv jilosi). */
  time: number;
  /** Tuman siljish tezligi ko'paytuvchisi (hover'da tezlashadi). */
  mistOffset: number;
}

/**
 * Butun sahnani chizadi (CSS piksellarida; `ctx` oldindan devicePixelRatio bo'yicha masshtablangan).
 * Ufq `hy`da; ostidagi suv — osmonning ko'zgu aksi (ranglar o'tish bo'yi osmonga ergashadi).
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  s: SceneParams,
  a: SceneAssets,
  { time, mistOffset }: DrawOptions,
): void {
  const hy = Math.round(h * 0.66);
  const waterH = h - hy;
  const day = 1 - s.night;

  // 1) Osmon
  const skyGrad = ctx.createLinearGradient(0, 0, 0, hy);
  skyGrad.addColorStop(0, rgba(s.sky.top));
  skyGrad.addColorStop(0.55, rgba(s.sky.mid));
  skyGrad.addColorStop(1, rgba(s.sky.horizon));
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, w, hy);

  // Shom/tongda ufq ustidagi iliq yog'du
  if (s.warmth > 0.01) {
    const glow = ctx.createRadialGradient(w * 0.3, hy, 0, w * 0.3, hy, w * 0.7);
    glow.addColorStop(0, rgba([255, 170, 90], 0.45 * s.warmth));
    glow.addColorStop(1, rgba([255, 170, 90], 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, hy);
  }

  // 2) Yulduzlar
  if (s.night > 0.01) {
    for (const st of a.stars) {
      const tw = 0.55 + 0.45 * Math.sin(time * st.speed + st.phase);
      ctx.fillStyle = rgba(WHITE, s.night * tw * 0.9);
      ctx.beginPath();
      ctx.arc(st.x * w, st.y * hy, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 3) Quyosh va oy (faqat osmon qismida — ufq ortiga "botadi")
  const sunX = w * 0.3;
  const sunR = Math.max(9, h * 0.075);
  const sunY = lerp(hy + sunR * 0.4, h * 0.2, s.sun);
  const moonX = w * 0.76;
  const moonY = h * 0.25;
  const moonR = Math.max(8, h * 0.07);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, hy);
  ctx.clip();
  // Quyosh ufq ostida chuqur bo'lsa (tun) — na disk, na yog'du; ufqqa yaqinlashgan sari ko'rinadi
  const sunVisible = smoothstep(-0.12, 0.04, s.sun);
  if (sunVisible > 0.01) {
    const altitude = clamp01(s.sun);
    const sunColor = mix([255, 160, 70], [255, 248, 222], altitude);
    const glowR = sunR * lerp(7, 4, altitude);
    const sg = ctx.createRadialGradient(sunX, sunY, sunR * 0.6, sunX, sunY, glowR);
    sg.addColorStop(0, rgba(sunColor, 0.55 * sunVisible));
    sg.addColorStop(1, rgba(sunColor, 0));
    ctx.fillStyle = sg;
    ctx.fillRect(sunX - glowR, sunY - glowR, glowR * 2, glowR * 2);
    ctx.fillStyle = rgba(sunColor, sunVisible);
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.fill();
  }
  if (s.night > 0.01) {
    const mg = ctx.createRadialGradient(moonX, moonY, moonR * 0.8, moonX, moonY, moonR * 5);
    mg.addColorStop(0, rgba([190, 200, 255], 0.28 * s.night));
    mg.addColorStop(1, rgba([190, 200, 255], 0));
    ctx.fillStyle = mg;
    ctx.fillRect(moonX - moonR * 5, moonY - moonR * 5, moonR * 10, moonR * 10);
    const md = ctx.createRadialGradient(
      moonX - moonR * 0.3,
      moonY - moonR * 0.3,
      0,
      moonX,
      moonY,
      moonR,
    );
    md.addColorStop(0, rgba(WHITE, s.night));
    md.addColorStop(1, rgba(MOON, s.night * 0.92));
    ctx.fillStyle = md;
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 4) Bulutlar — kunduz va shomda; shomda pastdan iliq yoritiladi
  const cloudAlpha = clamp01(day * 1.15) * 0.92;
  if (cloudAlpha > 0.01) {
    const top = mix(WHITE, [255, 214, 196], s.warmth);
    const under = mix([226, 236, 250], WARM, s.warmth);
    for (const c of a.clouds) {
      const cx = ((((c.x + time * c.speed) % 1.3) + 1.3) % 1.3) * w - w * 0.15;
      const cy = c.y * hy;
      for (const puff of c.puffs) {
        const pr = puff.r * h * 1.6 * c.scale;
        const px = cx + puff.dx * w * c.scale;
        const py = cy + puff.dy * h * c.scale;
        const g = ctx.createRadialGradient(px, py - pr * 0.3, 0, px, py, pr);
        g.addColorStop(0, rgba(top, cloudAlpha));
        g.addColorStop(0.6, rgba(under, cloudAlpha * 0.75));
        g.addColorStop(1, rgba(under, 0));
        ctx.fillStyle = g;
        ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
      }
    }
  }

  // 5) Uzoq qirg'oq siluyeti va uning aksi
  const shoreColor = mix(s.sky.horizon, [6, 8, 20], 0.62);
  const shoreH = h * 0.035;
  const step = w / (a.shore.length - 1);
  for (const mirror of [false, true]) {
    ctx.fillStyle = rgba(shoreColor, mirror ? 0.45 : 0.9);
    ctx.beginPath();
    ctx.moveTo(0, hy);
    a.shore.forEach((v, i) => ctx.lineTo(i * step, hy + (mirror ? 1 : -1) * v * shoreH));
    ctx.lineTo(w, hy);
    ctx.closePath();
    ctx.fill();
  }

  // 6) Suv: osmonning ko'zgu aksi (ufq yonida ufq rangi, pastga qarab — osmon tepasi), biroz qoraygan
  const wg = ctx.createLinearGradient(0, hy, 0, h);
  wg.addColorStop(0, rgba(mix(s.sky.horizon, [0, 0, 0], 0.22)));
  wg.addColorStop(0.45, rgba(mix(s.sky.mid, [0, 0, 0], 0.3)));
  wg.addColorStop(1, rgba(mix(s.sky.top, [0, 0, 0], 0.38)));
  ctx.fillStyle = wg;
  ctx.fillRect(0, hy + 1, w, waterH);

  // Yulduzlar aksi — xira, biroz titraydi
  if (s.night > 0.01) {
    for (const st of a.stars) {
      // Ko'zgu: ufqqa yaqin yulduz — ufq ostida, baland yulduz — suvning pastida
      const ry = hy + 2 + (1 - st.y) * (waterH - 4);
      const jitter = Math.sin(time * 1.3 + st.phase) * 1.2;
      ctx.fillStyle = rgba(
        WHITE,
        s.night * 0.3 * (0.6 + 0.4 * Math.sin(time * st.speed + st.phase)),
      );
      ctx.fillRect(st.x * w + jitter, ry, st.r * 1.6, Math.max(0.6, st.r * 0.5));
    }
  }

  // Quyosh/oy aksi: suvdagi jilvalanuvchi ustun
  const columns: { x: number; color: Rgb; alpha: number; width: number }[] = [];
  if (sunVisible > 0.01) {
    const altitude = clamp01(s.sun);
    columns.push({
      x: sunX,
      color: mix([255, 170, 90], [255, 250, 230], altitude),
      alpha: lerp(0.75, 0.35, altitude) * sunVisible,
      width: sunR * 2.4,
    });
  }
  if (s.night > 0.01)
    columns.push({ x: moonX, color: MOON, alpha: 0.5 * s.night, width: moonR * 2 });
  for (const col of columns) {
    const rows = 16;
    for (let i = 0; i < rows; i++) {
      const t = i / rows;
      const y = hy + 3 + t * waterH * 0.9;
      const wobble = Math.sin(time * 2.1 + i * 1.7) * col.width * 0.12;
      const len = col.width * (1 - t * 0.45) * (0.6 + 0.4 * Math.sin(time * 1.6 + i * 2.3));
      ctx.fillStyle = rgba(col.color, col.alpha * (1 - t) * 0.9);
      ctx.fillRect(col.x - len / 2 + wobble, y, len, Math.max(1, waterH * 0.018));
    }
  }

  // Suv yuzasidagi mayin jilo chiziqlari
  const shimmer = mix([150, 170, 230], WHITE, day);
  for (const sk of a.streaks) {
    const alpha = (0.05 + 0.08 * day) * (0.5 + 0.5 * Math.sin(time * 0.9 + sk.phase));
    ctx.fillStyle = rgba(shimmer, alpha);
    const x = (((sk.x + time * 0.004) % 1) + 1) % 1;
    ctx.fillRect(x * w, hy + 4 + sk.y * (waterH - 6), sk.len * w, 1);
  }

  // 7) Tuman — ufq va suv ustida past suzib yuradi (tunda qalin, kunduzi yupqa)
  const mistAmount = lerp(0.14, 1, s.night) + s.warmth * 0.12;
  const mistColor = mix([236, 242, 255], [148, 160, 206], s.night);
  for (let i = 0; i < 4; i++) {
    const band = (i * 0.37 + mistOffset * (0.012 + i * 0.004)) % 1.6;
    const mx = (band - 0.3) * w;
    const my = hy + (i - 1.5) * h * 0.045;
    const rx = w * (0.38 + i * 0.05);
    const ry = h * (0.07 + (i % 2) * 0.03);
    ctx.save();
    ctx.translate(mx, my);
    ctx.scale(rx / ry, 1);
    const mg = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
    mg.addColorStop(0, rgba(mistColor, 0.32 * mistAmount));
    mg.addColorStop(1, rgba(mistColor, 0));
    ctx.fillStyle = mg;
    ctx.fillRect(-ry, -ry, ry * 2, ry * 2);
    ctx.restore();
  }
}
