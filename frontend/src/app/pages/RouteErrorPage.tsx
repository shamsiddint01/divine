import { useRouteError } from 'react-router';
import { t } from '@/i18n/uz';
import { ErrorState } from '@/shared/components/ErrorState';

/** Sahifa render paytida yiqilsa — texnik tafsilotsiz o'zbekcha xabar. */
export function RouteErrorPage() {
  const error = useRouteError();
  if (import.meta.env.DEV) console.error(error);
  return (
    <div className="p-6">
      <ErrorState message={t.errors.pageCrashed} onRetry={() => window.location.reload()} />
    </div>
  );
}
