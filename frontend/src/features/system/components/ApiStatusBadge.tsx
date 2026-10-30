import { Circle, FlaskConical } from 'lucide-react';
import { t } from '@/i18n/uz';
import { isMockMode } from '@/shared/lib/api-mode';
import { Badge } from '@/shared/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';
import { useHealthQuery } from '../api/health';

/** Mock rejimda — "Demo rejim" belgisi; http rejimda — real `/health` holati. */
export function ApiStatusBadge() {
  if (isMockMode()) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="warning" className="cursor-default">
            <FlaskConical aria-hidden />
            {t.topbar.demoBadge}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{t.topbar.demoHint}</TooltipContent>
      </Tooltip>
    );
  }
  return <HealthBadge />;
}

export function HealthBadge() {
  const { data, isPending, isError } = useHealthQuery();
  if (isPending) {
    return (
      <Badge variant="secondary">
        <Circle className="fill-current" aria-hidden />
        {t.system.apiChecking}
      </Badge>
    );
  }
  if (isError) {
    return (
      <Badge variant="destructive">
        <Circle className="fill-current" aria-hidden />
        {t.system.apiOffline}
      </Badge>
    );
  }
  return data.status === 'ok' ? (
    <Badge variant="success">
      <Circle className="fill-current" aria-hidden />
      {t.system.apiOnline}
    </Badge>
  ) : (
    <Badge variant="warning">
      <Circle className="fill-current" aria-hidden />
      {t.system.apiDegraded}
    </Badge>
  );
}
