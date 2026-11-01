import { BarChart3, LogIn, Plus, Send, ShoppingCart, Truck, Warehouse, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { t } from '@/i18n/uz';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import './landing.css';

/** "Bepul sinab ko'rish" / "Bepul boshlash" — o'z-o'zidan ro'yxatdan o'tish yo'q, Telegram kanal orqali. */
const TELEGRAM_URL = 'https://t.me/+BvvsmvXvWZQ1YjAy';
const PHONE_HREF = `tel:${t.landing.footer.phone.replace(/\s/g, '')}`;

const SECTIONS = [
  { id: 'imkoniyatlar', label: t.landing.nav.features },
  { id: 'qanday-ishlaydi', label: t.landing.nav.how },
  { id: 'savollar', label: t.landing.nav.faq },
] as const;

const FEATURES = [
  { icon: Warehouse, ...t.landing.features.warehouse },
  { icon: ShoppingCart, ...t.landing.features.sales },
  { icon: Truck, ...t.landing.features.incoming },
  { icon: BarChart3, ...t.landing.features.reports },
];

/** Belgi: do'kon peshtoqini eslatuvchi uchta qiya chiziq (marjon gradient). */
function Logo() {
  // Sahifada belgi bir necha marta — gradient id'lari to'qnashmasin (url(#…) uchun xavfsiz belgilar).
  const id = `ld-logo-${useId().replace(/[^\w-]/g, '')}`;
  return (
    <svg viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF8A73" />
          <stop offset="1" stopColor="#F0605A" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill={`url(#${id})`} opacity=".14" />
      <g stroke={`url(#${id})`} strokeWidth="2.6" strokeLinecap="round">
        <path d="M8 22.5 12.5 9.5" />
        <path d="M14.2 22.5 18.7 9.5" />
        <path d="M20.4 22.5 24.9 9.5" />
      </g>
      <path
        d="M6.5 24.5h19"
        stroke="#fff"
        strokeOpacity=".55"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Brand() {
  return (
    <Link to="/welcome" className="ld-brand" aria-label={t.landing.home}>
      <Logo />
      <span>{t.app.name}</span>
    </Link>
  );
}

function TelegramButton({ label, className }: { label: string; className?: string }) {
  return (
    <a
      href={TELEGRAM_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`ld-btn ld-btn--coral ${className ?? ''}`}
    >
      {label}
      <span className="sr-only"> — {t.landing.opensTelegram}</span>
    </a>
  );
}

/** Sahifa ichidagi bo'limga silliq o'tish (sticky header ostida qolmasligi — `scroll-margin-top`). */
const scrollToSection = (id: string) =>
  document.getElementById(id)?.scrollIntoView({ block: 'start' });

/** Telefon/planshet menyusi: to'liq ekranli qora panel (fokus, Esc va scroll qulfi — Radix). */
function MobileMenu() {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="ld-burger" aria-label={t.landing.menuOpen}>
        <span />
        <span />
        <span />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Content
          className="ld-menu"
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            // Bo'lim tanlangan bo'lsa — menyu yopilgach (scroll qulfi yechilgach) o'sha bo'limga o'tiladi.
            if (!target) return;
            e.preventDefault();
            scrollToSection(target);
            setTarget(null);
          }}
        >
          <div className="ld-menu__top">
            <Dialog.Title asChild>
              <span className="ld-brand">
                <Logo />
                <span>{t.app.name}</span>
                <span className="sr-only"> — {t.landing.menu}</span>
              </span>
            </Dialog.Title>
            <Dialog.Close className="ld-menu__close" aria-label={t.landing.menuClose}>
              <X className="size-6" />
            </Dialog.Close>
          </div>
          <nav aria-label={t.landing.mainMenu}>
            <ul>
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      setTarget(s.id);
                      setOpen(false);
                    }}
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ld-menu__actions">
            <Link to="/login" className="ld-btn ld-btn--ghost">
              <LogIn />
              {t.landing.signIn}
            </Link>
            <TelegramButton label={t.landing.start} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** `/welcome`: login talab qilmaydigan ochiq tanishtiruv sahifasi. */
export function LandingPage() {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [scrolled, setScrolled] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="ld">
      <div className="ld-scale">
        <header className="ld-header" data-scrolled={scrolled}>
          <div className="ld-header__bar">
            <Brand />
            <nav className="ld-nav" aria-label={t.landing.mainMenu}>
              <ul>
                {SECTIONS.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="ld-underline">
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="ld-header__actions">
              <Link to="/login" className="ld-underline">
                {t.landing.signIn}
              </Link>
              <TelegramButton label={t.landing.start} />
            </div>
            <MobileMenu />
          </div>
        </header>

        <main className="ld-main">
          <section className="ld-hero" aria-labelledby="ld-hero-title">
            {reduceMotion ? null : (
              <video
                className="ld-hero__video"
                src="/landing/smoke.mp4"
                muted
                autoPlay
                loop
                playsInline
                preload="auto"
                aria-hidden
                tabIndex={-1}
                data-ready={videoReady}
                onLoadedData={() => setVideoReady(true)}
              />
            )}
            <svg className="ld-hero__frame" aria-hidden>
              <defs>
                <linearGradient id="ld-frame-gradient" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="rgb(244,118,104)" stopOpacity=".67" />
                  <stop offset="1" stopColor="rgb(244,118,104)" stopOpacity=".29" />
                </linearGradient>
              </defs>
              <rect pathLength={1} stroke="url(#ld-frame-gradient)" />
            </svg>

            <div className="ld-hero__content">
              <h1 id="ld-hero-title" className="ld-hero__title">
                {t.landing.heroTitle}
              </h1>
              <p className="ld-hero__text">
                {t.landing.heroLines.map((line) => (
                  <span key={line}>{line} </span>
                ))}
              </p>
              <div className="ld-hero__actions">
                <TelegramButton label={t.landing.tryFree} />
                <Link to="/login" className="ld-btn ld-btn--ghost">
                  <LogIn />
                  {t.landing.signIn}
                </Link>
              </div>
            </div>
          </section>

          <section id="imkoniyatlar" className="ld-section" aria-labelledby="ld-features-title">
            <div className="ld-section__head">
              <h2 id="ld-features-title" className="ld-section__title">
                {t.landing.featuresTitle}
              </h2>
              <p className="ld-section__lead">{t.landing.featuresLead}</p>
            </div>
            <ul className="ld-features">
              {FEATURES.map(({ icon: Icon, title, description }) => (
                <li key={title}>
                  <article className="ld-card">
                    <span className="ld-card__icon">
                      <Icon aria-hidden />
                    </span>
                    <h3>{title}</h3>
                    <p>{description}</p>
                  </article>
                </li>
              ))}
            </ul>
          </section>

          <section id="qanday-ishlaydi" className="ld-section" aria-labelledby="ld-how-title">
            <div className="ld-section__head">
              <h2 id="ld-how-title" className="ld-section__title">
                {t.landing.howTitle}
              </h2>
              <p className="ld-section__lead">{t.landing.howLead}</p>
            </div>
            <ol className="ld-steps">
              {t.landing.steps.map((step) => (
                <li key={step.title} className="ld-step">
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </li>
              ))}
            </ol>
          </section>

          <section id="savollar" className="ld-section" aria-labelledby="ld-faq-title">
            <div className="ld-section__head">
              <h2 id="ld-faq-title" className="ld-section__title">
                {t.landing.faqTitle}
              </h2>
            </div>
            <div className="ld-faq">
              {t.landing.faq.map((item) => (
                <details key={item.q}>
                  <summary>
                    {item.q}
                    <Plus aria-hidden />
                  </summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </section>
        </main>

        <footer className="ld-footer">
          <div className="ld-footer__top">
            <div className="ld-footer__about">
              <Brand />
              <p>{t.landing.footer.about}</p>
            </div>
            <div className="ld-footer__contact">
              <h2>{t.landing.footer.contactTitle}</h2>
              <p>
                <a className="ld-link" href={PHONE_HREF}>
                  {t.landing.footer.phone}
                </a>
              </p>
              <address>
                {t.landing.footer.address.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </address>
            </div>
          </div>
          <div className="ld-footer__bottom">
            <p>{t.landing.footer.copyright}</p>
            <p>
              <a className="ld-link" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
                <Send className="mr-1.5 inline size-[1em] align-[-0.125em]" aria-hidden />
                {t.landing.footer.telegram}
              </a>
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
