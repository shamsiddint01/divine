import {
  Building2,
  Coins,
  DatabaseZap,
  Loader2,
  PackageX,
  Save,
  ScrollText,
  SlidersHorizontal,
  Warehouse,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Permission } from '@divine/shared';
import { AuditLogView } from '@/features/audit/components/AuditLogView';
import { useHasAnyPermission } from '@/features/session/hooks/use-permissions';
import { t } from '@/i18n/uz';
import { isMockMode } from '@/shared/lib/api-mode';
import { normalizeNumberInput } from '@/shared/lib/decimal';
import { formatMoney, formatQuantity } from '@/shared/lib/format';
import { toastError } from '@/shared/lib/mutation';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';
import { ErrorState } from '@/shared/components/ErrorState';
import { FormField } from '@/shared/components/FormField';
import { PageHeader } from '@/shared/components/PageHeader';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Skeleton } from '@/shared/ui/skeleton';
import { Switch } from '@/shared/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import type { SettingsDto } from '@/shared/types/api';
import { useResetDemo, useSaveSettings, useSettings } from '../api/settings';
import { ThemeSceneToggle } from '../components/ThemeSceneToggle';

function Section({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <Card className="gap-5">
      <CardHeader className="flex flex-row items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-[18px]" />
        </span>
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{hint}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-lg border p-3 sm:col-span-2">
      <span className="space-y-0.5">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />
    </label>
  );
}

function SettingsForm({ initial: raw }: { initial: SettingsDto }) {
  // Chegara "5.000" emas, "5" ko'rinishida tahrirlanadi.
  const [initial] = useState(() => ({
    ...raw,
    lowStockDefaultThreshold: formatQuantity(raw.lowStockDefaultThreshold),
  }));
  const [draft, setDraft] = useState(initial);
  const save = useSaveSettings();
  const set = <K extends keyof SettingsDto>(key: K, value: SettingsDto[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const threshold = normalizeNumberInput(draft.lowStockDefaultThreshold);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  const onSave = async () => {
    if (!threshold || !draft.companyName.trim()) {
      toast.error(t.validation.nameRequired);
      return;
    }
    // Qisman PATCH: faqat o'zgargan maydonlar (API §16).
    const next: SettingsDto = { ...draft, lowStockDefaultThreshold: threshold };
    const changes = Object.fromEntries(
      (Object.keys(next) as (keyof SettingsDto)[])
        .filter((key) => next[key] !== initial[key])
        .map((key) => [key, next[key]]),
    ) as Partial<SettingsDto>;
    try {
      await save.mutateAsync(changes);
      toast.success(t.settings.saved);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="space-y-4">
      <Section
        icon={Building2}
        title={t.settings.sections.company}
        hint={t.settings.sections.companyHint}
      >
        <FormField id="s-company" label={t.settings.fields.companyName} required>
          <Input
            id="s-company"
            value={draft.companyName}
            onChange={(e) => set('companyName', e.target.value)}
          />
        </FormField>
      </Section>

      <Section
        icon={SlidersHorizontal}
        title={t.settings.sections.general}
        hint={t.settings.sections.generalHint}
      >
        <FormField id="s-lang" label={t.settings.fields.language}>
          <Input id="s-lang" value={t.settings.fields.languageValue} disabled />
        </FormField>
        <FormField id="s-tz" label={t.settings.fields.timezone}>
          <Input id="s-tz" value={t.settings.fields.timezoneValue} disabled />
        </FormField>
      </Section>

      <Section
        icon={Warehouse}
        title={t.settings.sections.warehouse}
        hint={t.settings.sections.warehouseHint}
      >
        <ToggleRow
          label={t.settings.fields.allowNegative}
          hint={t.settings.fields.allowNegativeHint}
          checked={false}
          disabled
        />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          icon={PackageX}
          title={t.settings.sections.lowStock}
          hint={t.settings.sections.lowStockHint}
        >
          <FormField
            id="s-low"
            label={t.settings.fields.lowStockThreshold}
            required
            className="sm:col-span-2"
          >
            <div className="flex items-center gap-2">
              <Input
                id="s-low"
                inputMode="decimal"
                className="w-32 tabular-nums"
                value={draft.lowStockDefaultThreshold}
                onChange={(e) => set('lowStockDefaultThreshold', e.target.value)}
                aria-invalid={!threshold}
              />
              <span className="text-sm text-muted-foreground">
                {t.settings.fields.lowStockUnit}
              </span>
            </div>
          </FormField>
        </Section>
        <Section
          icon={Coins}
          title={t.settings.sections.currency}
          hint={t.settings.sections.currencyHint}
        >
          <FormField id="s-cur" label={t.settings.fields.currencyCode}>
            <Input id="s-cur" value={t.settings.fields.currencyCodeValue} disabled />
          </FormField>
          <FormField id="s-cur-label" label={t.settings.fields.currencyLabel} required>
            <Input
              id="s-cur-label"
              value={draft.currencyLabel}
              onChange={(e) => set('currencyLabel', e.target.value)}
            />
          </FormField>
          <p className="text-sm text-muted-foreground sm:col-span-2">
            {t.settings.fields.preview}:{' '}
            <span className="font-medium text-foreground tabular-nums">
              {formatMoney('1250000.50')}
            </span>
          </p>
        </Section>
      </div>

      {/* Saqlash paneli faqat o'zgarish bo'lganda: doim turgan nofaol tugma kontentni to'sib turmaydi. */}
      {dirty || save.isPending ? (
        <div
          role="region"
          aria-label={t.settings.unsaved}
          className="sticky bottom-[calc(var(--mobile-nav-h,0px)+1rem)] z-10 flex flex-col gap-3 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur animate-in fade-in-0 slide-in-from-bottom-2 sm:flex-row sm:items-center sm:justify-between sm:pl-5"
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className="size-2 rounded-full bg-warning" aria-hidden />
            {t.settings.unsaved}
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="flex-1 sm:flex-none"
              onClick={() => setDraft(initial)}
              disabled={save.isPending}
            >
              {t.common.cancel}
            </Button>
            <Button className="flex-1 sm:flex-none" onClick={onSave} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              {t.common.saveChanges}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Sozlamalar (API §16) va audit jurnali (Phase 13, A-20 — shu bo'limda). Audit bo'limi faqat
 * `audit.read` bilan ko'rinadi va so'raladi.
 */
export function SettingsPage() {
  const canAudit = useHasAnyPermission([Permission.AUDIT_READ]);
  const [params, setParams] = useSearchParams();
  const tab = canAudit && params.get('tab') === 'audit' ? 'audit' : 'general';

  return (
    <>
      <ThemeSceneToggle />
      <PageHeader title={t.nav.settings} description={t.settings.description} />
      {canAudit ? (
        <Tabs
          value={tab}
          onValueChange={(v) => setParams(v === 'audit' ? { tab: v } : {}, { replace: true })}
        >
          <TabsList>
            <TabsTrigger value="general">
              <SlidersHorizontal />
              {t.settings.tabs.general}
            </TabsTrigger>
            <TabsTrigger value="audit">
              <ScrollText />
              {t.settings.tabs.audit}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="space-y-4">
            <GeneralSettings />
          </TabsContent>
          <TabsContent value="audit">
            <AuditLogView />
          </TabsContent>
        </Tabs>
      ) : (
        <GeneralSettings />
      )}
    </>
  );
}

function GeneralSettings() {
  const { data, isPending, error, refetch } = useSettings();
  const resetDemo = useResetDemo();
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <>
      {error ? (
        <ErrorState message={error.message} onRetry={() => refetch()} />
      ) : isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <SettingsForm key={JSON.stringify(data)} initial={data} />
      )}

      {isMockMode() ? (
        <Card className="gap-4 border-dashed">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
                <DatabaseZap className="size-[18px]" />
              </span>
              <div className="space-y-1">
                <CardTitle>{t.settings.sections.demo}</CardTitle>
                <CardDescription>{t.settings.sections.demoHint}</CardDescription>
              </div>
            </div>
            <Button variant="outline" onClick={() => setConfirmReset(true)}>
              {t.settings.resetDemo}
            </Button>
          </CardHeader>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t.settings.resetDemoTitle}
        description={t.settings.resetDemoDescription}
        confirmLabel={t.settings.resetDemo}
        destructive
        onConfirm={async () => {
          try {
            await resetDemo.mutateAsync();
            toast.success(t.settings.resetDemoDone);
          } catch (e) {
            toastError(e);
            throw e;
          }
        }}
      />
    </>
  );
}
