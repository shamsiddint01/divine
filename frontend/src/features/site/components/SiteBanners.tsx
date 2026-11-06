import { LICENSE_CONTACT_PHONE, LICENSE_WARNING_DAYS, Permission } from '@divine/shared';
import { Eye, ShieldQuestion, TriangleAlert } from 'lucide-react';
import { useHasAnyPermission } from '@/features/session/hooks/use-permissions';
import { t } from '@/i18n/uz';
import { readViewToken } from '@/shared/lib/view-session';
import { Button } from '@/shared/ui/button';
import { useDenySiteAccess, useSiteAccessRequest, useSiteLicense } from '../api/site';

const BANNER = 'flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5 text-sm sm:px-6';

function LicenseBanner() {
  const { data } = useSiteLicense();
  if (!data || data.daysLeft > LICENSE_WARNING_DAYS) return null;
  return (
    <div role="status" className={`${BANNER} border-amber-500/30 bg-amber-500/10`}>
      <TriangleAlert className="size-4 shrink-0 text-amber-500" aria-hidden />
      <span>{t.site.licenseWarning(data.ownerName, data.daysLeft, LICENSE_CONTACT_PHONE)}</span>
    </div>
  );
}

function AccessRequestBanner() {
  const canManage = useHasAnyPermission([Permission.SETTINGS_MANAGE]);
  const { data } = useSiteAccessRequest(canManage);
  const deny = useDenySiteAccess();
  if (!data) return null;
  return (
    <div role="alert" className={`${BANNER} border-primary/30 bg-primary/10`}>
      <ShieldQuestion className="size-4 shrink-0 text-primary" aria-hidden />
      <span>{t.site.accessRequest}</span>
      <span className="font-mono text-base font-semibold tracking-widest">{data.code}</span>
      <Button
        size="sm"
        variant="outline"
        className="ml-auto"
        disabled={deny.isPending}
        onClick={() => deny.mutate(data.id)}
      >
        {t.site.accessDeny}
      </Button>
    </div>
  );
}

/** Sayt tepasidagi xabarlar: ko'rish rejimi, to'lov eslatmasi, superadmin so'rovi. */
export function SiteBanners() {
  if (readViewToken()) {
    return (
      <div role="status" className={`${BANNER} border-primary/30 bg-primary/10`}>
        <Eye className="size-4 shrink-0 text-primary" aria-hidden />
        <span>{t.site.viewMode}</span>
      </div>
    );
  }
  return (
    <>
      <LicenseBanner />
      <AccessRequestBanner />
    </>
  );
}
