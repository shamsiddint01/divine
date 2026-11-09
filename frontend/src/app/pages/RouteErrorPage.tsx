import { useEffect } from 'react';
import { Link, useLocation, useRouteError } from 'react-router';
import { reportError } from '@/features/support/api/support';
import { t } from '@/i18n/uz';
import { ErrorState } from '@/shared/components/ErrorState';
import { Button } from '@/shared/ui/button';

/** Sahifa render paytida yiqilsa — texnik tafsilotsiz o'zbekcha xabar; xato egasiga o'zi yuboriladi. */
export function RouteErrorPage() {
  const error = useRouteError();
  const { pathname } = useLocation();
  if (import.meta.env.DEV) console.error(error);
  useEffect(() => {
    reportError({
      message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      page: pathname,
      errorCode: 'PAGE_CRASH',
    });
  }, [error, pathname]);
  return (
    <div className="space-y-4 p-6">
      <ErrorState message={t.errors.pageCrashed} onRetry={() => window.location.reload()} />
      <div className="flex justify-center">
        <Button variant="outline" asChild>
          <Link to={`/support?tab=new&code=PAGE_CRASH&page=${encodeURIComponent(pathname)}`}>
            {t.support.report}
          </Link>
        </Button>
      </div>
    </div>
  );
}
