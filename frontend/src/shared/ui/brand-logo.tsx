import { type ComponentProps, useId } from 'react';
import { t } from '@/i18n/uz';
import { cn } from '@/shared/lib/utils';
import { useUiStore } from '@/stores/ui.store';

/**
 * Divine.uz logotipi: "Analitika D" belgisi (o'sish ustunlari + oltin yulduz) va "ivine✦uz" yozuvi.
 * Yozuv Manrope ExtraBold'dan chiziqqa aylantirilgan — shrift yuklanishiga bog'liq emas.
 * Fayl ko'rinishlari: public/brand/*.svg (shu yerdagi shakllar bilan bir xil).
 */
type Variant = 'light' | 'dark' | 'auto';

const STAR =
  'M0-1C0.09-0.32 0.32-0.09 1 0C0.32 0.09 0.09 0.32 0 1C-0.09 0.32-0.32 0.09-1 0C-0.32-0.09-0.09-0.32 0-1Z';
const D = 'M12 10h18a22 22 0 0 1 0 44H12Z';
const HIGHLIGHT = 'M14 12h16a20 20 0 0 1 17.3 10';
const IVINE =
  'M40.50 12.94L34.52 12.94L34.52 7.66L40.50 7.66L40.50 12.94ZM40.50 40L34.52 40L34.52 16.24L40.50 16.24L40.50 40ZM58.91 40L52.93 40L44.30 16.24L50.29 16.24L55.92 32.70L61.55 16.24L67.54 16.24L58.91 40ZM77.32 12.94L71.34 12.94L71.34 7.66L77.32 7.66L77.32 12.94ZM77.32 40L71.34 40L71.34 16.24L77.32 16.24L77.32 40ZM105.58 40L99.51 40L99.51 28.78Q99.51 27.97 99.42 26.70Q99.34 25.44 98.87 24.16Q98.41 22.88 97.37 22.03Q96.32 21.17 94.41 21.17L94.41 21.17Q93.64 21.17 92.76 21.41Q91.88 21.65 91.11 22.35Q90.34 23.04 89.84 24.38Q89.35 25.72 89.35 27.94L89.35 27.94L85.92 26.32Q85.92 23.50 87.06 21.04Q88.20 18.57 90.50 17.05Q92.80 15.54 96.30 15.54L96.30 15.54Q99.09 15.54 100.85 16.48Q102.61 17.43 103.59 18.88Q104.57 20.33 104.99 21.91Q105.41 23.48 105.50 24.78Q105.58 26.07 105.58 26.67L105.58 26.67L105.58 40ZM89.35 40L83.28 40L83.28 16.24L88.60 16.24L88.60 24.12L89.35 24.12L89.35 40ZM121.75 40.66L121.75 40.66Q118.10 40.66 115.31 39.09Q112.53 37.51 110.96 34.75Q109.38 31.99 109.38 28.43L109.38 28.43Q109.38 24.53 110.92 21.65Q112.46 18.77 115.17 17.18Q117.88 15.58 121.40 15.58L121.40 15.58Q125.14 15.58 127.75 17.34Q130.37 19.10 131.63 22.29Q132.88 25.48 132.51 29.79L132.51 29.79L126.59 29.79L126.59 27.59Q126.59 23.96 125.43 22.37Q124.28 20.77 121.66 20.77L121.66 20.77Q118.60 20.77 117.16 22.63Q115.72 24.49 115.72 28.12L115.72 28.12Q115.72 31.44 117.16 33.26Q118.60 35.07 121.40 35.07L121.40 35.07Q123.16 35.07 124.41 34.30Q125.66 33.53 126.32 32.08L126.32 32.08L132.31 33.80Q130.97 37.05 128.07 38.86Q125.18 40.66 121.75 40.66ZM129.62 29.79L113.87 29.79L113.87 25.35L129.62 25.35L129.62 29.79Z';
const UZ =
  'M166.51 40.70L166.51 40.70Q163.72 40.70 161.96 39.76Q160.20 38.81 159.22 37.36Q158.24 35.91 157.82 34.34Q157.41 32.76 157.32 31.46Q157.23 30.17 157.23 29.57L157.23 29.57L157.23 16.24L163.30 16.24L163.30 27.46Q163.30 28.27 163.39 29.54Q163.48 30.80 163.94 32.08Q164.40 33.36 165.45 34.21Q166.49 35.07 168.41 35.07L168.41 35.07Q169.18 35.07 170.06 34.83Q170.94 34.59 171.71 33.90Q172.48 33.20 172.97 31.85Q173.47 30.50 173.47 28.30L173.47 28.30L176.90 29.92Q176.90 32.74 175.75 35.20Q174.61 37.67 172.31 39.19Q170.01 40.70 166.51 40.70ZM179.49 40L174.21 40L174.21 32.12L173.47 32.12L173.47 16.24L179.49 16.24L179.49 40ZM203.31 40L182.85 40L182.85 39.25L194.51 21.43L184.17 21.43L184.17 16.24L203.75 16.24L203.75 16.99L192.14 34.81L203.31 34.81L203.31 40Z';
const STAR_X = 143.59;
const WIDTH = 204.75;

/** Logotip shakllari — kirish animatsiyasi (IntroSplash) qismlarni alohida harakatlantiradi. */
export const BRAND_SHAPES = { STAR, D, IVINE, UZ, STAR_X, WIDTH } as const;

/** `auto` — joriy mavzu: och mavzuda to'q belgi, qorong'ida "shisha" belgi. */
function useResolvedVariant(variant: Variant): 'light' | 'dark' {
  const theme = useUiStore((s) => s.theme);
  return variant === 'auto' ? theme : variant;
}

/** Bir sahifada bir necha logotip — gradient id'lari to'qnashmasin (url(#…) uchun xavfsiz belgilar). */
function useGradientIds() {
  const base = `brand-${useId().replace(/[^\w-]/g, '')}`;
  return { d: `${base}-d`, bar: `${base}-b`, white: `${base}-w`, star: `${base}-s` };
}

function Gradients({ ids }: { ids: ReturnType<typeof useGradientIds> }) {
  return (
    <defs>
      <linearGradient id={ids.d} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#2E3878" />
        <stop offset="1" stopColor="#11152E" />
      </linearGradient>
      <linearGradient id={ids.bar} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#7484FF" />
        <stop offset="1" stopColor="#3D4EDB" />
      </linearGradient>
      <linearGradient id={ids.white} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" />
        <stop offset="1" stopColor="#C9D0F5" />
      </linearGradient>
      <radialGradient id={ids.star} cx=".42" cy=".38" r=".65">
        <stop offset="0" stopColor="#FFF6D2" />
        <stop offset=".3" stopColor="#FFD978" />
        <stop offset=".7" stopColor="#F1AC2C" />
        <stop offset="1" stopColor="#B9771A" />
      </radialGradient>
    </defs>
  );
}

/** Belgi shakllari 64×64 koordinatada; `dark` — qorong'i fon uchun yarim shaffof "shisha" D. */
function MarkShapes({
  ids,
  variant,
}: {
  ids: ReturnType<typeof useGradientIds>;
  variant: 'light' | 'dark';
}) {
  const dark = variant === 'dark';
  return (
    <>
      {dark ? (
        <path
          d={D}
          fill="#fff"
          fillOpacity=".2"
          stroke="#fff"
          strokeOpacity=".8"
          strokeWidth="1.6"
        />
      ) : (
        <>
          <path d={D} fill={`url(#${ids.d})`} />
          <path d={HIGHLIGHT} fill="none" stroke="#5363C9" strokeWidth=".8" opacity=".6" />
        </>
      )}
      <rect
        x="20"
        y="38"
        width="5"
        height="8"
        rx="1.5"
        fill={dark ? '#fff' : `url(#${ids.white})`}
        opacity={dark ? 0.7 : 1}
      />
      <rect
        x="28"
        y="32"
        width="5"
        height="14"
        rx="1.5"
        fill={dark ? '#fff' : `url(#${ids.white})`}
        opacity={dark ? 0.85 : 1}
      />
      <rect x="36" y="25" width="5" height="21" rx="1.5" fill={`url(#${ids.bar})`} />
      <path transform="translate(38.5 15) scale(8.5)" d={STAR} fill={`url(#${ids.star})`} />
    </>
  );
}

type SvgProps = Omit<ComponentProps<'svg'>, 'viewBox'> & { variant?: Variant };

/** Faqat belgi (kvadrat) — yig'ilgan sidebar, kichik joylar. */
export function BrandMark({ variant = 'auto', className, ...props }: SvgProps) {
  const v = useResolvedVariant(variant);
  const ids = useGradientIds();
  return (
    <svg
      viewBox="6 4 52 52"
      role="img"
      aria-label={t.app.name}
      className={cn('shrink-0', className)}
      {...props}
    >
      <Gradients ids={ids} />
      <MarkShapes ids={ids} variant={v} />
    </svg>
  );
}

/** To'liq logotip: belgi so'zning bosh harfi "D" vazifasida + "ivine✦uz". Balandlik className orqali (`h-8`). */
export function BrandLogo({ variant = 'auto', className, ...props }: SvgProps) {
  const v = useResolvedVariant(variant);
  const ids = useGradientIds();
  const dark = v === 'dark';
  return (
    <svg
      viewBox={`0 4 ${WIDTH} 38`}
      role="img"
      aria-label={t.app.name}
      className={cn('w-auto shrink-0', className)}
      {...props}
    >
      <Gradients ids={ids} />
      <g transform="translate(-8.64 1.12) scale(.72)">
        <MarkShapes ids={ids} variant={v} />
      </g>
      <path d={IVINE} fill={dark ? '#FFFFFF' : '#1B2140'} />
      <path transform={`translate(${STAR_X} 32) scale(8)`} d={STAR} fill={`url(#${ids.star})`} />
      <path d={UZ} fill={dark ? '#C3CBFF' : '#3D4EDB'} />
    </svg>
  );
}
