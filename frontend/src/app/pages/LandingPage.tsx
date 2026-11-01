import { ArrowRight, BarChart3, LogIn, ShoppingCart, Truck, Warehouse } from 'lucide-react';
import { Link } from 'react-router';
import { t } from '@/i18n/uz';
import { Button } from '@/shared/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

const FEATURES = [
  { icon: Warehouse, ...t.landing.features.warehouse },
  { icon: ShoppingCart, ...t.landing.features.sales },
  { icon: Truck, ...t.landing.features.incoming },
  { icon: BarChart3, ...t.landing.features.reports },
];

/** `/welcome`: login talab qilmaydigan ochiq tanishtiruv sahifasi. */
export function LandingPage() {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/welcome" className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground">
              {t.app.name.charAt(0)}
            </span>
            <span className="text-lg font-semibold">{t.app.name}</span>
          </Link>
          <Button asChild variant="outline">
            <Link to="/login">
              <LogIn />
              {t.landing.signIn}
            </Link>
          </Button>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-24">
          <h1 className="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">
            {t.landing.heroTitle}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-pretty text-muted-foreground sm:text-lg">
            {t.landing.heroDescription}
          </p>
          <Button asChild size="lg" className="mt-8">
            <Link to="/login">
              {t.landing.start}
              <ArrowRight />
            </Link>
          </Button>
        </section>

        <section
          aria-labelledby="landing-features"
          className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24"
        >
          <h2 id="landing-features" className="mb-6 text-center text-2xl font-semibold">
            {t.landing.featuresTitle}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <li key={title}>
                <Card className="h-full">
                  <CardHeader className="gap-3">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <CardTitle className="text-base">{title}</CardTitle>
                    <CardDescription>{description}</CardDescription>
                  </CardHeader>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t">
        <p className="mx-auto max-w-6xl px-4 py-6 text-center text-sm text-muted-foreground sm:px-6">
          {t.landing.footer}
        </p>
      </footer>
    </div>
  );
}
