import { ArrowLeft, SearchX } from 'lucide-react';
import { Link } from 'react-router';
import { t } from '@/i18n/uz';
import { ApiError } from '@/shared/lib/api-client';
import { Button } from '@/shared/ui/button';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { PageHeader } from './PageHeader';

interface DetailErrorPageProps {
  error: Error;
  /** Bo'lim nomi (breadcrumb va qaytish havolasi uchun), masalan "Mijozlar". */
  sectionLabel: string;
  sectionTo: string;
  onRetry: () => void;
}

/**
 * Detal sahifasi yuklanmadi: 404 bo'lsa — "topilmadi" + ro'yxatga qaytish (qayta urinish ma'nosiz),
 * boshqa xatolarda — qayta urinish. Sahifa sarlavhasi (h1) va breadcrumb saqlanadi.
 */
export function DetailErrorPage({ error, sectionLabel, sectionTo, onRetry }: DetailErrorPageProps) {
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <div className="space-y-6">
      <PageHeader
        title={notFound ? t.detailNotFound.title : t.common.errorTitle}
        breadcrumbs={[{ label: sectionLabel, to: sectionTo }, { label: t.detailNotFound.crumb }]}
      />
      {notFound ? (
        <EmptyState
          icon={SearchX}
          title={t.detailNotFound.description}
          action={
            <Button asChild variant="outline">
              <Link to={sectionTo}>
                <ArrowLeft />
                {t.detailNotFound.back(sectionLabel)}
              </Link>
            </Button>
          }
        />
      ) : (
        <ErrorState message={error.message || t.errors.unexpected} onRetry={onRetry} />
      )}
    </div>
  );
}
