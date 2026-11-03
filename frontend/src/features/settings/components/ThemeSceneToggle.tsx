import { Moon, Sun } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@/i18n/uz';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { cn } from '@/shared/lib/utils';
import { type Theme, useUiStore } from '@/stores/ui.store';
import {
  type Direction,
  type SceneState,
  type SceneTextures,
  buildNextCloud,
  createSceneAssets,
  createSceneTextures,
  drawScene,
  easeInOutCubic,
  sceneParams,
} from './theme-scene';

/** Quyosh chiqishi / botishi davomiyligi; harakat kamaytirilganda — qisqa aralashtirish. */
const TRANSITION_MS = 3600;
const REDUCED_MS = 300;

interface Transition {
  dir: Direction;
  target: Theme;
  start: number;
  duration: number;
  direct: boolean;
  /** UI mavzusi o'tishning o'rtasida almashadi — sahna va interfeys bir paytda o'zgaradi. */
  switched: boolean;
}

/** Teksturalar sahifalar orasida saqlanadi — Sozlamalarga qayta kirilganda qayta yaratilmaydi. */
let sharedTextures: SceneTextures | null | undefined;

const restState = (theme: Theme): SceneState => ({
  dir: 'toDay',
  p: theme === 'light' ? 1 : 0,
  direct: false,
});

/**
 * Sozlamalar tepasidagi mavzu banneri: suv, tuman, osmon. Butun banner — `role="switch"` tugma:
 * tun ↔ kunduz (ui.store'dagi yagona mavzu tizimi). Boshqa joyda (boshqa tab) mavzu o'zgarsa —
 * sahna darhol moslashadi. Ekrandan chiqsa yoki tab yashirilsa — chizish to'xtaydi.
 */
export function ThemeSceneToggle() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [busy, setBusy] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const assets = useRef(createSceneAssets());
  const scene = useRef<SceneState>(restState(theme));
  const transition = useRef<Transition | null>(null);
  const size = useRef({ w: 0, h: 0 });
  const visible = useRef(true);
  const hovered = useRef(false);
  const clock = useRef({ last: 0, time: 0, mist: 0 });
  const frame = useRef(0);
  // Moslashuvchan sifat: kadr uzoq vaqt sekin bo'lsa (kuchsiz qurilma), canvas piksel zichligi pasayadi
  const quality = useRef({ scale: 1, avgMs: 16, frames: 0 });
  const resizeRef = useRef<() => void>(() => {});
  // Zanjirdagi eng so'nggi holatlar (rAF ichida eskirgan qiymat ishlatilmasin)
  const live = useRef({ reduceMotion, setTheme });
  useEffect(() => {
    live.current = { reduceMotion, setTheme };
  }, [reduceMotion, setTheme]);

  /** Bitta kadr: vaqtni oldinga surish, o'tishni hisoblash va chizish. */
  const render = useCallback((now: number) => {
    const c = clock.current;
    const dt = c.last ? Math.min(0.1, (now - c.last) / 1000) : 0;
    c.last = now;
    c.time += dt;
    if (dt > 0 && dt < 0.1) {
      const q = quality.current;
      q.avgMs = q.avgMs * 0.92 + dt * 1000 * 0.08;
      q.frames++;
      // ~42 fps dan past barqaror bo'lsa — bir pog'ona pastroq aniqlik (eng kami 1×)
      if (q.frames > 50 && q.avgMs > 24) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const next = Math.max(1 / dpr, q.scale - 0.25);
        if (next < q.scale) {
          q.scale = next;
          resizeRef.current();
        }
        q.frames = 0;
        q.avgMs = 16;
      }
    }
    // Hover'da tuman tezroq suzadi (silliq tezlanish)
    c.mist += dt * (hovered.current ? 2.4 : 1);

    const tr = transition.current;
    if (tr) {
      const raw = Math.min(1, (now - tr.start) / tr.duration);
      const eased = tr.direct ? raw : easeInOutCubic(raw);
      scene.current = { dir: tr.dir, p: eased, direct: tr.direct };
      if (!tr.switched && raw >= 0.5) {
        tr.switched = true;
        live.current.setTheme(tr.target);
      }
      if (raw >= 1) {
        transition.current = null;
        scene.current = restState(tr.target);
        setBusy(false);
      }
    }

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const { w, h } = size.current;
    if (!canvas || !ctx || !w || !h) return;
    const dpr = canvas.width / w;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScene(ctx, w, h, sceneParams(scene.current), assets.current, {
      time: c.time,
      mistOffset: c.mist,
      dpr,
    });
  }, []);

  /** Siklni (qayta) boshlash — sikl o'zi pastdagi effektda; bu yerda faqat unga havola. */
  const kickRef = useRef<() => void>(() => {});
  const kick = useCallback(() => kickRef.current(), []);

  // O'lcham: canvas piksellari = CSS o'lcham × devicePixelRatio (≤2, sifat bo'yicha); maket siljimaydi
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Oy, tuman, to'lqin teksturalari — bir marta; og'ir kumulus bulutlar — quyida, birma-bir
    sharedTextures ??= createSceneTextures();
    assets.current.textures = sharedTextures;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1) * quality.current.scale;
      size.current = { w: rect.width, h: rect.height };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      render(performance.now());
    };
    resizeRef.current = resize;
    resize();
    // Bulutlar: har biri alohida vazifada — sahifa qotmaydi; tayyor bo'lgani ohista paydo bo'ladi
    const tx = sharedTextures;
    let cloudTimer = 0;
    const nextCloud = () => {
      if (!tx) return;
      const more = buildNextCloud(tx);
      // Harakat kamaytirilgan: sikl aylanmaydi — paydo bo'lish animatsiyasisiz, darhol to'liq
      if (live.current.reduceMotion) tx.cloudsReadyAt[tx.cloudsReadyAt.length - 1]! -= 1000;
      kick();
      if (more) cloudTimer = window.setTimeout(nextCloud, 16);
    };
    if (tx) cloudTimer = window.setTimeout(nextCloud, 60);
    if (typeof ResizeObserver === 'undefined') return () => window.clearTimeout(cloudTimer);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      window.clearTimeout(cloudTimer);
    };
  }, [render, kick]);

  // Sikl faqat kerak bo'lganda aylanadi: ko'rinib turibdi va (idle harakat yoki o'tish bor).
  // Ekrandan chiqsa yoki tab yashirilsa — pauza; qaytganda davom etadi.
  useEffect(() => {
    const tick = (now: number) => {
      render(now);
      const needed =
        visible.current &&
        !document.hidden &&
        (!live.current.reduceMotion || transition.current !== null);
      frame.current = needed ? requestAnimationFrame(tick) : 0;
      if (!needed) clock.current.last = 0;
    };
    kickRef.current = () => {
      if (!frame.current) frame.current = requestAnimationFrame(tick);
    };
    const canvas = canvasRef.current;
    let io: IntersectionObserver | undefined;
    if (canvas && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(([entry]) => {
        visible.current = entry?.isIntersecting ?? true;
        if (visible.current) kick();
      });
      io.observe(canvas);
    }
    const onVisibility = () => {
      if (!document.hidden) kick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    kick();
    return () => {
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      kickRef.current = () => {};
    };
  }, [render, kick]);

  // Harakat sozlamasi o'zgarsa — sikl qayta baholanadi (idle harakat yoqiladi/o'chadi)
  useEffect(() => {
    kick();
  }, [reduceMotion, kick]);

  // Mavzu boshqa joyda o'zgarsa (o'tish paytida emas) — sahna darhol shu holatga o'tadi
  useEffect(() => {
    if (transition.current) return;
    const expected = restState(theme);
    if (scene.current.p !== expected.p) {
      scene.current = expected;
      kick();
      render(performance.now());
    }
  }, [theme, kick, render]);

  const toggle = () => {
    // O'tish davomida bosilgan bosish e'tiborsiz — sahna hech qachon "sakramaydi"
    if (transition.current) return;
    const target: Theme = theme === 'dark' ? 'light' : 'dark';
    transition.current = {
      dir: target === 'light' ? 'toDay' : 'toNight',
      target,
      start: performance.now(),
      duration: reduceMotion ? REDUCED_MS : TRANSITION_MS,
      direct: reduceMotion,
      switched: false,
    };
    setBusy(true);
    kick();
  };

  const isLight = theme === 'light';
  const Icon = isLight ? Sun : Moon;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isLight}
      aria-label={isLight ? t.settings.themeScene.toNight : t.settings.themeScene.toDay}
      aria-busy={busy}
      onClick={toggle}
      onPointerEnter={() => (hovered.current = true)}
      onPointerLeave={() => (hovered.current = false)}
      className={cn(
        'group relative block h-40 w-full cursor-pointer overflow-hidden rounded-xl border bg-[#05071a] text-left shadow-sm sm:h-56 lg:h-60',
        'transition-[filter] duration-300 hover:brightness-110',
        'outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      )}
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-hidden />
      {/* Ishora: hozirgi rejim va "bosing" — sahna ustida, har ikki holatda o'qiladi */}
      <span className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full border border-white/20 bg-black/35 py-1.5 pr-3.5 pl-2 text-white backdrop-blur-md sm:bottom-4 sm:left-4">
        <span className="flex size-7 items-center justify-center rounded-full bg-white/15">
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">
            {isLight ? t.settings.themeScene.day : t.settings.themeScene.night}
          </span>
          <span className="text-[11px] text-white/75">{t.settings.themeScene.hint}</span>
        </span>
      </span>
    </button>
  );
}
