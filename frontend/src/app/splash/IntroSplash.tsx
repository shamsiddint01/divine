import { useCallback, useEffect, useId, useState } from 'react';
import { BRAND_SHAPES } from '@/shared/ui/brand-logo';
import './splash.css';

/**
 * Saytga kirishdagi logotip animatsiyasi (har bir tab sessiyasida bir marta). Ilova orqada shu
 * vaqtda yuklanadi; bosish yoki Esc — darhol o'tkazib yuborish; `prefers-reduced-motion` — ko'rsatilmaydi.
 * Variantlar: 1 — "Yig'ilish", 2 — "O'sish grafigi", 3 — "Yulduz porlashi" (`?splash=1|2|3` bilan majburan).
 */
export type SplashVariant = 1 | 2 | 3;

const SEEN_KEY = 'divine.splash.seen';
/** Asosiy harakat davomiyligi (ms); undan keyin chiqish animatsiyasi. */
const PLAY_MS: Record<SplashVariant, number> = { 1: 2300, 2: 2500, 3: 2400 };
const EXIT_MS = 600;
const DEFAULT_VARIANT: SplashVariant = 1;

const { STAR, D, IVINE, UZ, STAR_X, WIDTH } = BRAND_SHAPES;

function readSeen(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* saqlab bo'lmasa ham animatsiya faqat shu safar ko'rinadi */
  }
}

/** `?splash=2` — ko'rib chiqish uchun variantni majburan ko'rsatish (sessiya belgisiga qaramay). */
function forcedVariant(): SplashVariant | null {
  const value = new URLSearchParams(window.location.search).get('splash');
  return value === '1' || value === '2' || value === '3' ? (Number(value) as SplashVariant) : null;
}

function shouldShow(): { show: boolean; variant: SplashVariant } {
  const forced = forcedVariant();
  if (forced) return { show: true, variant: forced };
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  return { show: !reduce && !readSeen(), variant: DEFAULT_VARIANT };
}

export function IntroSplash() {
  const [{ show, variant }] = useState(shouldShow);
  const [phase, setPhase] = useState<'play' | 'exit' | 'done'>(show ? 'play' : 'done');
  const uid = useId().replace(/[^\w-]/g, '');
  const id = (name: string) => `splash-${uid}-${name}`;

  const exit = useCallback(() => setPhase((p) => (p === 'play' ? 'exit' : p)), []);

  useEffect(() => {
    if (!show) return;
    markSeen();
    const toExit = window.setTimeout(exit, PLAY_MS[variant]);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') exit();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(toExit);
      window.removeEventListener('keydown', onKey);
    };
  }, [show, variant, exit]);

  useEffect(() => {
    if (phase !== 'exit') return;
    const toDone = window.setTimeout(() => setPhase('done'), EXIT_MS);
    return () => window.clearTimeout(toDone);
  }, [phase]);

  if (phase === 'done') return null;

  return (
    <div
      className="splash"
      data-variant={variant}
      data-phase={phase}
      aria-hidden
      onClick={exit}
    >
      <div className="splash-bg" />
      <div className="splash-rays" />
      <div className="splash-logo">
        <svg viewBox={`0 4 ${WIDTH} 38`} overflow="visible">
          <defs>
            <linearGradient id={id('bar')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#7484FF" />
              <stop offset="1" stopColor="#3D4EDB" />
            </linearGradient>
            <radialGradient id={id('star')} cx=".42" cy=".38" r=".65">
              <stop offset="0" stopColor="#FFF6D2" />
              <stop offset=".3" stopColor="#FFD978" />
              <stop offset=".7" stopColor="#F1AC2C" />
              <stop offset="1" stopColor="#B9771A" />
            </radialGradient>
            <radialGradient id={id('glow')}>
              <stop offset="0" stopColor="#FFD978" stopOpacity=".9" />
              <stop offset="1" stopColor="#FFD978" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={id('shine')} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset=".5" stopColor="#fff" stopOpacity=".85" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <mask id={id('mask')} maskUnits="userSpaceOnUse" x="-20" y="-10" width="250" height="70">
              <g fill="#fff">
                <g transform="translate(-8.64 1.12) scale(.72)">
                  <path d={D} />
                </g>
                <path d={IVINE} />
                <path d={UZ} />
              </g>
            </mask>
          </defs>

          {/* Belgi ("D" + o'sish ustunlari) — 64×64 koordinatada */}
          <g transform="translate(-8.64 1.12) scale(.72)">
            <path className="s-d" d={D} pathLength={1} />
            <rect className="s-bar s-bar1" x="20" y="38" width="5" height="8" rx="1.5" />
            <rect className="s-bar s-bar2" x="28" y="32" width="5" height="14" rx="1.5" />
            <rect
              className="s-bar s-bar3"
              x="36"
              y="25"
              width="5"
              height="21"
              rx="1.5"
              fill={`url(#${id('bar')})`}
            />
            <polyline className="s-line" points="22.5,38 30.5,32 38.5,25 38.5,17" pathLength={1} />
          </g>

          {/* Yozuv: ivine ✦ uz */}
          <g className="s-word">
            <path className="s-ivine" d={IVINE} />
            <g className="s-star2">
              <path
                transform={`translate(${STAR_X} 32) scale(8)`}
                d={STAR}
                fill={`url(#${id('star')})`}
              />
            </g>
            <path className="s-uz" d={UZ} />
          </g>

          {/* Oltin yulduz (belgidagi): alohida — markazdan o'z joyiga ucha oladi (3-variant) */}
          <circle className="s-glow" cx="19.08" cy="11.92" r="16" fill={`url(#${id('glow')})`} />
          <circle className="s-burst" cx="19.08" cy="11.92" r="7" />
          <g className="s-star-move">
            <g className="s-star">
              <path
                transform="translate(19.08 11.92) scale(6.12)"
                d={STAR}
                fill={`url(#${id('star')})`}
              />
            </g>
          </g>

          {/* Yaltirash — faqat logotip shakllari ichida */}
          <g mask={`url(#${id('mask')})`}>
            <rect className="s-shine" x="-70" y="0" width="60" height="50" fill={`url(#${id('shine')})`} />
          </g>
        </svg>
      </div>
    </div>
  );
}
