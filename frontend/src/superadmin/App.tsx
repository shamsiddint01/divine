import {
  type ControlEventDto,
  type ControlSiteDetailDto,
  type ControlSiteDto,
  type ControlSiteStatus,
  nextPaidUntil,
} from '@divine/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Lock, LockOpen, LogOut, Plus, RefreshCw, Timer, Trash2 } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { DatePicker } from '@/shared/components/DatePicker';
import { formatDate, formatMoney, formatPhone, todayInTashkent } from '@/shared/lib/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/shared/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Textarea } from '@/shared/ui/textarea';
import { PanelError, panelApi } from './api';
import { maskDate, parseDayMonthYear, toDayMonthYear } from './date-text';

const SITES_KEY = ['sites'] as const;
const siteKey = (id: string) => ['site', id] as const;

const STATUS: Record<ControlSiteStatus, { label: string; className: string }> = {
  ACTIVE: { label: 'Faol', className: 'bg-emerald-500/15 text-emerald-500' },
  EXPIRING: { label: 'Tugayapti', className: 'bg-amber-500/15 text-amber-500' },
  EXPIRED: { label: 'Bloklangan', className: 'bg-destructive/15 text-destructive' },
};

const EVENT_LABELS: Record<string, string> = {
  SITE_CREATED: 'Sayt qo‘shildi',
  SITE_UPDATED: 'O‘zgartirildi',
  PAYMENT_ADDED: 'To‘lov yozildi',
  PAYMENT_DELETED: 'To‘lov o‘chirildi',
  VIEW_REQUESTED: 'Ko‘rish so‘raldi',
  VIEW_OPENED: 'Sayt ko‘rildi',
};

function eventText(event: ControlEventDto) {
  const label = EVENT_LABELS[event.action] ?? event.action;
  const d = event.details as Record<string, string | boolean | null | undefined>;
  if (event.action === 'PAYMENT_ADDED' && typeof d.amount === 'string') {
    return `${label}: ${formatMoney(d.amount, { withCurrency: true })}, ${formatDate(String(d.paidUntil))} gacha`;
  }
  if (event.action === 'SITE_UPDATED') {
    if (d.manualBlock === true) return 'Qo‘lda bloklandi';
    if (d.manualBlock === false) return 'Blok olib tashlandi';
    if ('graceUntil' in d) return d.graceUntil ? `Yengillik: ${formatDate(String(d.graceUntil))} gacha` : 'Yengillik bekor qilindi';
  }
  return label;
}

const formatTimestamp = (iso: string) =>
  new Date(iso).toLocaleString('uz-UZ', {
    timeZone: 'Asia/Tashkent',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

function EventList({ siteId }: { siteId?: string }) {
  const { data } = useQuery({
    queryKey: ['events', siteId ?? 'all'],
    queryFn: () => panelApi.events(siteId),
  });
  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">Hali harakat yo‘q</p>;
  }
  return (
    <ul className="divide-y rounded-lg border text-sm">
      {data.slice(0, 30).map((event) => (
        <li key={event.id} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 p-3">
          <span>
            {siteId ? null : <span className="font-medium">{event.siteName ?? '—'}: </span>}
            {eventText(event)}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatTimestamp(event.occurredAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function daysLabel(site: ControlSiteDto) {
  if (site.daysLeft < 0) return `${-site.daysLeft} kun oldin tugagan`;
  if (site.daysLeft === 0) return 'Bugun oxirgi kun';
  return `${site.daysLeft} kun qoldi`;
}

const values = (event: FormEvent<HTMLFormElement>) =>
  Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/** Sana `kun.oy.yil`da ko'rinadi (brauzerning `oy/kun/yil` maydoni adashtirgan edi); formaga yashirin qiymat. */
function DateField({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <DatePicker value={value} onChange={onChange} disableFuture={false} />
    </>
  );
}

function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {error instanceof Error ? error.message : 'Xatolik yuz berdi'}
    </p>
  );
}

function LoginScreen() {
  const queryClient = useQueryClient();
  const login = useMutation({
    mutationFn: panelApi.login,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SITES_KEY }),
  });
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Superadmin</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              const { login: name, password } = values(event);
              login.mutate({ login: name ?? '', password: password ?? '' });
            }}
          >
            <Field label="Login">
              <Input name="login" autoComplete="username" required autoFocus />
            </Field>
            <Field label="Parol">
              <Input name="password" type="password" autoComplete="current-password" required />
            </Field>
            <ErrorText error={login.error} />
            <Button type="submit" disabled={login.isPending}>
              {login.isPending ? 'Tekshirilmoqda…' : 'Kirish'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function SiteForm({
  site,
  onSubmit,
  pending,
  error,
}: {
  site?: ControlSiteDetailDto;
  onSubmit: (input: Record<string, string>) => void;
  pending: boolean;
  error: unknown;
}) {
  const [paidUntil, setPaidUntil] = useState(site ? toDayMonthYear(site.paidUntil) : '');
  const [dateError, setDateError] = useState(false);
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const date = parseDayMonthYear(paidUntil);
        setDateError(!date);
        if (date) onSubmit({ ...values(event), paidUntil: date });
      }}
    >
      <Field label="Sayt nomi">
        <Input name="name" defaultValue={site?.name} required />
      </Field>
      <Field label="Egasining ismi">
        <Input name="ownerName" defaultValue={site?.ownerName} required />
      </Field>
      <Field label="Egasining telefoni">
        <Input name="ownerPhone" defaultValue={site?.ownerPhone ?? ''} inputMode="tel" />
      </Field>
      <Field label="Kelishilgan summa (oyiga, so‘m)">
        <Input name="agreedPrice" defaultValue={site?.agreedPrice} inputMode="decimal" required />
      </Field>
      <Field label="To‘lov muddati: kun/oy/yil (shu kungacha ishlaydi)">
        <Input
          value={paidUntil}
          onChange={(event) => {
            setPaidUntil(maskDate(event.target.value));
            setDateError(false);
          }}
          // To'liq sana ustiga yozib bo'lmaydi (8 raqamdan ortig'i tashlanadi): bosganda belgilanadi.
          onFocus={(event) => event.currentTarget.select()}
          inputMode="numeric"
          placeholder="06/12/2026"
          aria-invalid={dateError}
          required
        />
        {dateError ? (
          <p role="alert" className="text-sm text-destructive">
            Sanani kun/oy/yil ko‘rinishida to‘g‘ri yozing
          </p>
        ) : null}
      </Field>
      <Field label="Sayt manzili">
        <Input name="siteUrl" type="url" defaultValue={site?.siteUrl} required />
      </Field>
      <Field label="API manzili">
        <Input name="apiUrl" type="url" defaultValue={site?.apiUrl} required />
      </Field>
      {site ? null : (
        <Field label="Sayt kaliti">
          <Input name="apiToken" type="password" autoComplete="off" required />
          <p className="text-xs text-muted-foreground">
            Superadmin paroli emas: yangi mijoz sayti o‘rnatilganda beriladigan texnik kalit.
          </p>
        </Field>
      )}
      <Field label="Izoh">
        <Textarea name="notes" rows={2} defaultValue={site?.notes ?? ''} />
      </Field>
      <ErrorText error={error} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Saqlanmoqda…' : 'Saqlash'}
      </Button>
    </form>
  );
}

function PaymentForm({ site }: { site: ControlSiteDetailDto }) {
  const queryClient = useQueryClient();
  const [paidAt, setPaidAt] = useState(todayInTashkent());
  const pay = useMutation({
    mutationFn: (input: Record<string, string>) =>
      panelApi.addPayment(site.id, {
        amount: input.amount ?? '',
        paidAt: input.paidAt ?? '',
        note: input.note ?? null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: siteKey(site.id) });
      await queryClient.invalidateQueries({ queryKey: SITES_KEY });
    },
  });
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        pay.mutate(values(event), { onSuccess: () => form.reset() });
      }}
    >
      <Field label="Summa">
        <Input name="amount" defaultValue={site.agreedPrice} inputMode="decimal" required />
      </Field>
      <Field label="To‘langan sana">
        <DateField name="paidAt" value={paidAt} onChange={setPaidAt} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Izoh">
          <Input name="note" />
        </Field>
      </div>
      <p className="text-sm text-muted-foreground sm:col-span-2">
        Bir oyga uzayadi. Keyingi to‘lov:{' '}
        <span className="font-medium text-foreground">
          {formatDate(nextPaidUntil(site.paidUntil, paidAt))}
        </span>
      </p>
      <div className="sm:col-span-2">
        <ErrorText error={pay.error} />
        <Button type="submit" disabled={pay.isPending} className="mt-2 w-full">
          {pay.isPending ? 'Saqlanmoqda…' : 'To‘lovni yozish'}
        </Button>
      </div>
    </form>
  );
}

const VIEW_STATUS_POLL_MS = 6_000;

function ViewAccess({ siteId }: { siteId: string }) {
  const [requestId, setRequestId] = useState<string | null>(null);
  const ask = useMutation({
    mutationFn: () => panelApi.requestView(siteId),
    onSuccess: (result) => setRequestId(result.id),
  });
  const verify = useMutation({
    mutationFn: (code: string) => panelApi.verifyView(siteId, requestId ?? '', code),
    onSuccess: ({ viewUrl }) => {
      setRequestId(null);
      window.open(viewUrl, '_blank', 'noopener');
    },
  });
  const { data: state } = useQuery({
    queryKey: ['view-request', requestId],
    queryFn: () => panelApi.viewStatus(siteId, requestId ?? ''),
    enabled: requestId !== null,
    refetchInterval: (query) =>
      (query.state.data?.status ?? 'PENDING') === 'PENDING' ? VIEW_STATUS_POLL_MS : false,
  });
  const closedReason =
    state?.status === 'DENIED'
      ? 'Admin so‘rovni rad etdi'
      : state?.status === 'EXPIRED'
        ? 'Kod muddati tugadi'
        : null;
  if (!requestId || closedReason) {
    return (
      <div className="grid gap-2">
        <Button variant="outline" disabled={ask.isPending} onClick={() => ask.mutate()}>
          <Eye />
          {ask.isPending ? 'So‘rov yuborilmoqda…' : 'Saytni ko‘rish'}
        </Button>
        {closedReason ? (
          <p role="status" className="text-sm text-destructive">
            {closedReason}
          </p>
        ) : null}
        <ErrorText error={ask.error} />
      </div>
    );
  }
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        verify.mutate(values(event).code ?? '');
      }}
    >
      <p className="text-sm text-muted-foreground">
        Adminga so‘rov ketdi. U aytgan 6 xonali kodni kiriting (10 daqiqa amal qiladi).
      </p>
      <div className="flex gap-2">
        <Input
          name="code"
          inputMode="numeric"
          maxLength={6}
          pattern="[0-9]{6}"
          aria-label="Admin kodi"
          required
          autoFocus
        />
        <Button type="submit" disabled={verify.isPending}>
          Ochish
        </Button>
      </div>
      <ErrorText error={verify.error} />
    </form>
  );
}

function SiteSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const { data: site, error } = useQuery({
    queryKey: siteKey(id),
    queryFn: () => panelApi.site(id),
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: siteKey(id) });
    await queryClient.invalidateQueries({ queryKey: SITES_KEY });
  };
  const update = useMutation({
    mutationFn: (input: Record<string, string>) => panelApi.updateSite(id, input),
    onSuccess: async () => {
      setEditing(false);
      await refresh();
    },
  });
  const sync = useMutation({ mutationFn: () => panelApi.sync(id), onSuccess: refresh });
  const control = useMutation({
    mutationFn: (input: { manualBlock?: boolean; graceUntil?: string | null }) =>
      panelApi.updateSite(id, input),
    onSuccess: async () => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ['events'] });
    },
  });
  const graceWeek = () => {
    const from = site && site.paidUntil > todayInTashkent() ? site.paidUntil : todayInTashkent();
    const date = new Date(`${from}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 7);
    control.mutate({ graceUntil: date.toISOString().slice(0, 10) });
  };
  const removePayment = useMutation({
    mutationFn: (paymentId: string) => panelApi.deletePayment(id, paymentId),
    onSuccess: refresh,
  });

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{site?.name ?? 'Sayt'}</SheetTitle>
        </SheetHeader>
        <div className="grid gap-6 px-4 pb-6">
          <ErrorText error={error} />
          {site ? (
            <>
              {editing ? (
                <SiteForm
                  site={site}
                  pending={update.isPending}
                  error={update.error}
                  onSubmit={(input) => update.mutate(input)}
                />
              ) : (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Holat</dt>
                  <dd>
                    <Badge className={STATUS[site.status].className}>
                      {STATUS[site.status].label}
                    </Badge>{' '}
                    <span className="text-muted-foreground">{daysLabel(site)}</span>
                  </dd>
                  <dt className="text-muted-foreground">Egasi</dt>
                  <dd>{site.ownerName}</dd>
                  <dt className="text-muted-foreground">Telefon</dt>
                  <dd>{site.ownerPhone ? formatPhone(site.ownerPhone) : '—'}</dd>
                  <dt className="text-muted-foreground">Kelishuv</dt>
                  <dd>{formatMoney(site.agreedPrice, { withCurrency: true })} / oy</dd>
                  <dt className="text-muted-foreground">Balans</dt>
                  <dd>
                    {formatMoney(site.balance, { withCurrency: true })}
                    <span className="block text-xs text-muted-foreground">
                      Keyingi oy uchun yana {formatMoney(site.amountDue, { withCurrency: true })}
                    </span>
                  </dd>
                  <dt className="text-muted-foreground">Oxirgi to‘lov</dt>
                  <dd>{site.lastPaidAt ? formatDate(site.lastPaidAt) : '—'}</dd>
                  <dt className="text-muted-foreground">Keyingi to‘lov</dt>
                  <dd>{formatDate(site.paidUntil)}</dd>
                  {site.graceUntil ? (
                    <>
                      <dt className="text-muted-foreground">Yengillik</dt>
                      <dd>{formatDate(site.graceUntil)} gacha</dd>
                    </>
                  ) : null}
                  <dt className="text-muted-foreground">Manzil</dt>
                  <dd className="break-all">
                    <a href={site.siteUrl} target="_blank" rel="noreferrer" className="underline">
                      {site.siteUrl}
                    </a>
                  </dd>
                  {site.notes ? (
                    <>
                      <dt className="text-muted-foreground">Izoh</dt>
                      <dd>{site.notes}</dd>
                    </>
                  ) : null}
                </dl>
              )}
              <Button variant="ghost" onClick={() => setEditing((value) => !value)}>
                {editing ? 'Bekor qilish' : 'Tahrirlash'}
              </Button>

              {site.synced ? null : (
                <div className="grid gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  <p>Bu o‘zgarish saytga yetib bormadi: sayt javob bermadi.</p>
                  <Button variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()}>
                    <RefreshCw />
                    {sync.isPending ? 'Yuborilmoqda…' : 'Qayta yuborish'}
                  </Button>
                  <ErrorText error={sync.error} />
                </div>
              )}

              <section className="grid gap-2">
                <h3 className="text-sm font-semibold">Boshqaruv</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    variant={site.manualBlock ? 'default' : 'outline'}
                    disabled={control.isPending}
                    onClick={() => control.mutate({ manualBlock: !site.manualBlock })}
                  >
                    {site.manualBlock ? <LockOpen /> : <Lock />}
                    {site.manualBlock ? 'Blokdan chiqarish' : 'Qo‘lda bloklash'}
                  </Button>
                  {site.graceUntil ? (
                    <Button
                      variant="outline"
                      disabled={control.isPending}
                      onClick={() => control.mutate({ graceUntil: null })}
                    >
                      <Timer />
                      Yengillikni bekor qilish
                    </Button>
                  ) : (
                    <Button variant="outline" disabled={control.isPending} onClick={graceWeek}>
                      <Timer />
                      +7 kun yengillik
                    </Button>
                  )}
                </div>
                <ErrorText error={control.error} />
              </section>

              <ViewAccess siteId={id} />

              <section className="grid gap-3">
                <h3 className="text-sm font-semibold">To‘lov yozish</h3>
                <PaymentForm site={site} />
              </section>

              <section className="grid gap-2">
                <h3 className="text-sm font-semibold">Jurnal</h3>
                <EventList siteId={id} />
              </section>

              <section className="grid gap-2">
                <h3 className="text-sm font-semibold">To‘lovlar tarixi</h3>
                {site.payments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Hali to‘lov yo‘q</p>
                ) : (
                  <ul className="divide-y rounded-lg border text-sm">
                    {site.payments.map((payment) => (
                      <li key={payment.id} className="flex items-center gap-3 p-3">
                        <span>
                          {formatDate(payment.paidAt)}
                          <span className="block text-xs text-muted-foreground">
                            {formatDate(payment.paidUntil)} gacha
                            {payment.note ? ` · ${payment.note}` : ''}
                          </span>
                        </span>
                        <span className="ml-auto font-medium">
                          {formatMoney(payment.amount, { withCurrency: true })}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="To‘lovni o‘chirish"
                          disabled={removePayment.isPending}
                          onClick={() => removePayment.mutate(payment.id)}
                        >
                          <Trash2 />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function NewSiteSheet({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (input: Record<string, string>) =>
      panelApi.createSite({
        name: input.name ?? '',
        siteUrl: input.siteUrl ?? '',
        apiUrl: input.apiUrl ?? '',
        apiToken: input.apiToken ?? '',
        ownerName: input.ownerName ?? '',
        ownerPhone: input.ownerPhone ?? null,
        agreedPrice: input.agreedPrice ?? '',
        paidUntil: input.paidUntil ?? '',
        notes: input.notes ?? null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SITES_KEY });
      onClose();
    },
  });
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Yangi sayt</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-6">
          <SiteForm
            pending={create.isPending}
            error={create.error}
            onSubmit={(input) => create.mutate(input)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DashboardCards() {
  const { data } = useQuery({ queryKey: ['dashboard'], queryFn: panelApi.dashboard });
  if (!data) return null;
  const cards = [
    { label: 'Shu oy tushum', value: formatMoney(data.revenueThisMonth, { withCurrency: true }) },
    { label: 'Shu oy kutilmoqda', value: formatMoney(data.expectedThisMonth, { withCurrency: true }) },
    { label: 'Faol saytlar', value: `${data.sites.active} / ${data.sites.total}` },
    {
      label: 'Tugayapti / bloklangan',
      value: `${data.sites.expiring} / ${data.sites.expired}`,
    },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label} className="gap-1 py-4">
          <CardContent className="space-y-1 px-4">
            <p className="text-sm text-muted-foreground">{card.label}</p>
            <p className="text-xl font-semibold tabular-nums">{card.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function HealthDot({ ok, ms }: { ok: boolean | undefined; ms: number | null | undefined }) {
  const label = ok === undefined ? 'Tekshirilmoqda' : ok ? `Ishlayapti, ${ms} ms` : 'Javob yo‘q';
  return (
    <span
      title={label}
      aria-label={label}
      className={`inline-block size-2.5 shrink-0 rounded-full ${
        ok === undefined ? 'bg-muted-foreground/40' : ok ? 'bg-emerald-500' : 'bg-destructive'
      }`}
    />
  );
}

function SitesScreen({ sites }: { sites: ControlSiteDto[] }) {
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: panelApi.health,
    refetchInterval: 60_000,
  });
  const healthOf = (id: string) => health?.find((item) => item.id === id);
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const logout = useMutation({
    mutationFn: panelApi.logout,
    onSuccess: () => queryClient.resetQueries({ queryKey: SITES_KEY }),
  });
  return (
    <main className="mx-auto min-h-svh max-w-5xl space-y-6 bg-background p-4 sm:p-6">
      <header className="flex items-center gap-3">
        <h1 className="mr-auto text-xl font-semibold">Saytlar</h1>
        <Button onClick={() => setAdding(true)}>
          <Plus />
          Sayt qo‘shish
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Chiqish"
          disabled={logout.isPending}
          onClick={() => logout.mutate()}
        >
          <LogOut />
        </Button>
      </header>
      <DashboardCards />
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sayt</TableHead>
                <TableHead>Egasi</TableHead>
                <TableHead>Holat</TableHead>
                <TableHead>Keyingi to‘lov</TableHead>
                <TableHead className="text-right">Kelishuv</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sites.map((site) => (
                <TableRow
                  key={site.id}
                  className="cursor-pointer"
                  tabIndex={0}
                  onClick={() => setSelected(site.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setSelected(site.id);
                  }}
                >
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      <HealthDot ok={healthOf(site.id)?.ok} ms={healthOf(site.id)?.ms} />
                      {site.name}
                    </span>
                  </TableCell>
                  <TableCell>{site.ownerName}</TableCell>
                  <TableCell>
                    <Badge className={STATUS[site.status].className}>
                      {STATUS[site.status].label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {formatDate(site.paidUntil)}
                    <span className="block text-xs text-muted-foreground">{daysLabel(site)}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    {formatMoney(site.agreedPrice, { withCurrency: true })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {sites.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Hali sayt yo‘q</p>
          ) : null}
        </CardContent>
      </Card>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Oxirgi harakatlar</h2>
        <EventList />
      </section>
      {selected ? <SiteSheet id={selected} onClose={() => setSelected(null)} /> : null}
      {adding ? <NewSiteSheet onClose={() => setAdding(false)} /> : null}
    </main>
  );
}

export function App() {
  const { data, error, isPending, refetch, isFetching } = useQuery({
    queryKey: SITES_KEY,
    queryFn: panelApi.sites,
  });
  if (isPending) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background text-sm text-muted-foreground">
        Yuklanmoqda…
      </main>
    );
  }
  if (error instanceof PanelError && error.status === 401) return <LoginScreen />;
  if (error) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background p-4">
        <ErrorText error={error} />
        <Button variant="outline" disabled={isFetching} onClick={() => void refetch()}>
          Qayta urinish
        </Button>
      </main>
    );
  }
  return <SitesScreen sites={data} />;
}
