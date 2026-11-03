import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { t } from '@/i18n/uz';
import { BRAND_PATHS } from '@/shared/ui/brand-logo';
import { useUiStore } from '@/stores/ui.store';
import './splash.css';

/**
 * Saytga kirishdagi logotip animatsiyasi: brauzer oynasida (sessiyada) bir marta, ~4.5 s.
 * Oxirida logotip sahifadagi o'z joyiga (`[data-brand-logo]`) uchib boradi; joy topilmasa — so'nadi.
 * Bosish yoki tugma — o'tkazib yuborish. Harakat o'chirilgan (reduced motion) va avtomatik
 * testlar (`navigator.webdriver`) uchun umuman ko'rsatilmaydi.
 */
const SEEN_KEY = 'divine.splash-seen';
/** Logotip to'liq yig'ilib, joyiga uchishni boshlaydigan payt (splash.css vaqtlari bilan mos). */
const INTRO_MS = 3700;
const EXIT_MS = 800;
const SKIP_MS = 300;

const { STAR, D, HIGHLIGHT, IVINE, UZ, STAR_X, WIDTH } = BRAND_PATHS;
/** Yulduz paydo bo'lganda sochiladigan uchqunlar yo'nalishi (belgi koordinatalarida). */
const SPARKS = [
  [16, -10],
  [11, 12],
  [-14, 9],
  [-12, -13],
  [2, -17],
  [18, 3],
] as const;
const DUST = Array.from({ length: 16 }, (_, i) => ({
  left: `${3 + i * 6 + (i % 3) * 2}%`,
  size: 6 + (i % 3) * 2,
  duration: `${2.6 + (i % 4) * 0.5}s`,
  delay: `${(0.3 + ((i * 0.23) % 1.6)).toFixed(2)}s`,
}));

function shouldShow(): boolean {
  if (typeof window === 'undefined' || navigator.webdriver) return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  try {
    return sessionStorage.getItem(SEEN_KEY) !== '1';
  } catch {
    return true;
  }
}

/** Sahifada ko'rinib turgan to'liq logotip (splashning o'zidan tashqari). */
function findTarget(): Element | null {
  for (const el of document.querySelectorAll('[data-brand-logo]')) {
    if (el.closest('.splash')) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.top >= 0 && r.bottom <= window.innerHeight) return el;
  }
  return null;
}

type Phase = 'intro' | 'exit' | 'skip' | 'done';

export function SplashScreen() {
  const [phase, setPhase] = useState<Phase>(() => (shouldShow() ? 'intro' : 'done'));
  const theme = useUiStore((s) => s.theme);
  const logoRef = useRef<SVGSVGElement>(null);
  // Landing doim qora — u yerda och mavzuda ham qorong'i splash (o'tish sakramasin).
  const [variant] = useState(() =>
    window.location.pathname.startsWith('/welcome') ? 'dark' : theme,
  );

  useEffect(() => {
    if (phase !== 'intro') return;
    try {
      sessionStorage.setItem(SEEN_KEY, '1');
    } catch {
      // Xotira yopiq — keyingi kirishda yana ko'rsatiladi.
    }
    const timer = window.setTimeout(() => setPhase('exit'), INTRO_MS);
    const skip = () => setPhase('skip');
    window.addEventListener('keydown', skip);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', skip);
    };
  }, [phase]);

  useEffect(() => {
    if (phase === 'skip') {
      const timer = window.setTimeout(() => setPhase('done'), SKIP_MS);
      return () => window.clearTimeout(timer);
    }
    if (phase !== 'exit') return;
    const logo = logoRef.current;
    const target = findTarget();
    if (logo && typeof logo.animate === 'function') {
      const from = logo.getBoundingClientRect();
      const to = target?.getBoundingClientRect();
      const frames = to
        ? [
            { transform: 'none', opacity: 1 },
            {
              transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width})`,
              opacity: 1,
              offset: 0.9,
            },
            {
              transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width})`,
              opacity: 0,
            },
          ]
        : [
            { transform: 'none', opacity: 1 },
            { transform: 'translate(-7.5%, -7.5%) scale(1.15)', opacity: 0 },
          ];
      logo.animate(frames, {
        duration: EXIT_MS,
        easing: 'cubic-bezier(.65,0,.35,1)',
        fill: 'forwards',
      });
    }
    const timer = window.setTimeout(() => setPhase('done'), EXIT_MS + 100);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === 'done') return null;
  const light = variant === 'light';

  return (
    <div
      aria-hidden
      data-testid="splash"
      className={`splash splash--${variant} ${phase === 'exit' ? 'is-exiting' : ''} ${phase === 'skip' ? 'is-skipped' : ''}`}
      onClick={() => phase === 'intro' && setPhase('skip')}
    >
      <div className="splash__bg" />
      <div className="splash__dust">
        {DUST.map((p) => (
          <span
            key={p.left}
            style={
              {
                left: p.left,
                width: p.size,
                height: p.size,
                '--d': p.duration,
                '--t': p.delay,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="splash__center">
        <svg ref={logoRef} className="splash__logo" viewBox={`0 4 ${WIDTH} 38`}>
          <defs>
            <linearGradient id="splash-d" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#2E3878" />
              <stop offset="1" stopColor="#11152E" />
            </linearGradient>
            <linearGradient id="splash-w" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" />
              <stop offset="1" stopColor="#C9D0F5" />
            </linearGradient>
            <linearGradient id="splash-b" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#7484FF" />
              <stop offset="1" stopColor="#3D4EDB" />
            </linearGradient>
            <radialGradient id="splash-s" cx=".42" cy=".38" r=".65">
              <stop offset="0" stopColor="#FFF6D2" />
              <stop offset=".3" stopColor="#FFD978" />
              <stop offset=".7" stopColor="#F1AC2C" />
              <stop offset="1" stopColor="#B9771A" />
            </radialGradient>
            <radialGradient id="splash-g">
              <stop offset="0" stopColor="#FFD978" stopOpacity=".75" />
              <stop offset="1" stopColor="#FFD978" stopOpacity="0" />
            </radialGradient>
            <clipPath id="splash-c">
              <path d={IVINE} />
              <path d={UZ} />
            </clipPath>
          </defs>
          <g transform="translate(-8.64 1.12) scale(.72)">
            {light ? (
              <>
                <path
                  className="sp-d"
                  pathLength={100}
                  d={D}
                  fill="url(#splash-d)"
                  stroke="#2E3878"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <path
                  className="sp-hl"
                  d={HIGHLIGHT}
                  fill="none"
                  stroke="#5363C9"
                  strokeWidth=".8"
                  opacity=".6"
                />
              </>
            ) : (
              <path
                className="sp-d"
                pathLength={100}
                d={D}
                fill="#fff"
                fillOpacity=".2"
                stroke="#fff"
                strokeOpacity=".8"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            )}
            <rect
              className="sp-bar sp-b1"
              x="20"
              y="38"
              width="5"
              height="8"
              rx="1.5"
              fill={light ? 'url(#splash-w)' : '#fff'}
              opacity={light ? 1 : 0.7}
            />
            <rect
              className="sp-bar sp-b2"
              x="28"
              y="32"
              width="5"
              height="14"
              rx="1.5"
              fill={light ? 'url(#splash-w)' : '#fff'}
              opacity={light ? 1 : 0.85}
            />
            <rect
              className="sp-bar sp-b3"
              x="36"
              y="25"
              width="5"
              height="21"
              rx="1.5"
              fill="url(#splash-b)"
            />
            <path
              className="sp-trend"
              pathLength={100}
              d="M17 44L22.5 36L30.5 30L38.5 22"
              fill="none"
              stroke="#F1AC2C"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <g transform="translate(38.5 15)">
              <circle className="sp-glow" r="16" fill="url(#splash-g)" />
              {SPARKS.map(([x, y]) => (
                <circle
                  key={`${x}:${y}`}
                  className="sp-pt"
                  r="1.1"
                  fill={light ? '#E0A12A' : '#FFD978'}
                  style={{ '--x': `${x}px`, '--y': `${y}px` } as CSSProperties}
                />
              ))}
              <g className="sp-star">
                <path transform="scale(8.5)" d={STAR} fill="url(#splash-s)" />
              </g>
            </g>
          </g>
          <path className="sp-text" d={IVINE} fill={light ? '#1B2140' : '#FFFFFF'} />
          <g transform={`translate(${STAR_X} 32)`}>
            <g className="sp-dot">
              <path transform="scale(8)" d={STAR} fill="url(#splash-s)" />
            </g>
          </g>
          <path className="sp-uz" d={UZ} fill={light ? '#3D4EDB' : '#C3CBFF'} />
          <g clipPath="url(#splash-c)">
            <g className="sp-shine">
              <rect
                x="-30"
                y="4"
                width="14"
                height="40"
                transform="skewX(-20)"
                fill="#fff"
                opacity={light ? 0.55 : 0.45}
              />
            </g>
          </g>
        </svg>
        <p className="splash__tagline">{t.app.tagline}</p>
      </div>
      <div className="splash__progress" />
    </div>
  );
}
