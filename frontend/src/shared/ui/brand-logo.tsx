import { type ComponentProps, useId } from 'react';
import { t } from '@/i18n/uz';
import { cn } from '@/shared/lib/utils';
import { useUiStore } from '@/stores/ui.store';
import { D, HIGHLIGHT, IVINE, STAR, STAR_X, UZ, WIDTH } from './brand-paths';

/**
 * Divine.uz logotipi: "Analitika D" belgisi (o'sish ustunlari + oltin yulduz) va "ivine✦uz" yozuvi.
 * Yozuv Manrope ExtraBold'dan chiziqqa aylantirilgan — shrift yuklanishiga bog'liq emas.
 * Fayl ko'rinishlari: public/brand/*.svg (shu yerdagi shakllar bilan bir xil).
 */
type Variant = 'light' | 'dark' | 'auto';

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
      data-brand-logo=""
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
