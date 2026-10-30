import { ArrowLeft, ShieldX } from 'lucide-react';
import { Link } from 'react-router';
import { t } from '@/i18n/uz';
import { EmptyState } from '@/shared/components/EmptyState';
import { PageHeader } from '@/shared/components/PageHeader';
import { Button } from '@/shared/ui/button';

/** Ruxsatsiz bo'limga to'g'ridan-to'g'ri URL bilan kirilganda (RBAC §5). Haqiqiy himoya — backend. */
export function ForbiddenPage() {
  return (
    <div className="space-y-6">
      <PageHeader title={t.forbidden.title} />
      <EmptyState
        icon={ShieldX}
        title={t.forbidden.description}
        action={
          <Button asChild variant="outline">
            <Link to="/">
              <ArrowLeft />
              {t.forbidden.backHome}
            </Link>
          </Button>
        }
      />
    </div>
  );
}
