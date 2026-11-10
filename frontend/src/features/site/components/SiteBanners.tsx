import { LICENSE_CONTACT_PHONE, LICENSE_WARNING_DAYS, Permission } from '@divine/shared';
import { Eye, Hourglass, Megaphone, ShieldQuestion, TriangleAlert } from 'lucide-react';
import { useAnnouncement } from '@/features/support/api/support';
import { useHasAnyPermission } from '@/features/session/hooks/use-permissions';
import { t } from '@/i18n/uz';
import { readViewToken } from '@/shared/lib/view-session';
import { Button } from '@/shared/ui/button';
import { useDemoStatus, useDenySiteAccess, useSiteAccessRequest, useSiteLicense } from '../api/site';

const BANNER = 'flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5 text-sm sm:px-6';

/** Egasining e'loni (masalan, texnik ishlar): hamma foydalanuvchiga. */
function AnnouncementBanner() {
  const { data } = useAnnouncement();
  if (!data) return null;
  const maintenance = data.kind === 'MAINTENANCE';
  return (
    <div
      role="status"
      className={`${BANNER} ${maintenance ? 'border-amber-500/30 bg-amber-500/10' : 'border-primary/30 bg-primary/10'}`}
    >
      <Megaphone
        className={`size-4 shrink-0 ${maintenance ? 'text-amber-500' : 'text-primary'}`}
        aria-hidden
      />
      <span>{data.text}</span>
    </div>
  );
}

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

/** Bepul sinab ko'rish: qancha vaqt qolgani (faqat sinov hisobida chiqadi). */
function DemoBanner() {
  const { data } = useDemoStatus();
  if (!data) return null;
  return (
    <div role="status" className={`${BANNER} border-primary/30 bg-primary/10`}>
      <Hourglass className="size-4 shrink-0 text-primary" aria-hidden />
      <span>{t.site.demoTrial(data.minutesLeft, LICENSE_CONTACT_PHONE)}</span>
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
      <AnnouncementBanner />
      <LicenseBanner />
      <DemoBanner />
      <AccessRequestBanner />
    </>
  );
}
