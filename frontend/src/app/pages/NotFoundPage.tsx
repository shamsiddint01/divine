import { SearchX } from 'lucide-react';
import { Link } from 'react-router';
import { t } from '@/i18n/uz';
import { EmptyState } from '@/shared/components/EmptyState';
import { PageHeader } from '@/shared/components/PageHeader';
import { Button } from '@/shared/ui/button';

export function NotFoundPage() {
  return (
    <>
      <PageHeader title={t.notFound.title} />
      <EmptyState
        icon={SearchX}
        title={t.notFound.description}
        action={
          <Button asChild variant="outline">
            <Link to="/">{t.common.goHome}</Link>
          </Button>
        }
      />
    </>
  );
}
