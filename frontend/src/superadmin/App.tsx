import {
  type ControlEventDto,
  type ControlTicketDto,
  type SupportStatus,
  type ControlSiteHealthDto,
  type ControlSiteDetailDto,
  type ControlSiteDto,
  type ControlSiteStatus,
  applyPayment,
} from '@divine/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Lock, LockOpen, LogOut, Plus, RefreshCw, Timer, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { DatePicker } from '@/shared/components/DatePicker';
import { formatDate, formatMoney, formatPhone, todayInTashkent } from '@/shared/lib/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/shared/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Textarea } from '@/shared/ui/textarea';
import { PanelError, panelApi } from './api';
import { ErrorText, Field, formatTimestamp, values } from './common';
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
  TICKET_REPLIED: 'Murojaatga javob yozildi',
  TICKET_STATUS: 'Murojaat holati o‘zgardi',
  ANNOUNCEMENT_SET: 'E’lon qo‘yildi',
  ANNOUNCEMENT_CLEARED: 'E’lon olib tashlandi',
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
    if ('graceUntil' in d)
      return d.graceUntil
        ? `Yengillik: ${formatDate(String(d.graceUntil))} gacha`
        : 'Yengillik bekor qilindi';
  }
  return label;
}

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

const TWO_FACTOR_NOTICE_SECONDS = 5;

function LoginScreen() {
  const queryClient = useQueryClient();
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const done = () => queryClient.invalidateQueries({ queryKey: SITES_KEY });
  const login = useMutation({
    mutationFn: panelApi.login,
    onSuccess: async (result) => {
      if (result.codeRequired && result.challengeId) setChallengeId(result.challengeId);
      else if (result.twoFactorPaused) {
        // Egasining so'rovi (2026-11-08): xabar 5 soniya ko'rinadi, keyin panel ochiladi.
        let left = TWO_FACTOR_NOTICE_SECONDS;
        setCountdown(left);
        const timer = setInterval(() => {
          left -= 1;
          setCountdown(left);
          if (left <= 0) {
            clearInterval(timer);
            void done();
          }
        }, 1_000);
      } else await done();
    },
  });
  const verify = useMutation({
    mutationFn: (code: string) => panelApi.verify(challengeId ?? '', code),
    onSuccess: done,
    onError: (error) => {
      // Kod eskirgan yoki urinishlar tugagan: paroldan qaytadan.
      if (error instanceof PanelError && error.status === 401) setChallengeId(null);
    },
  });
  if (countdown !== null) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm">
          <CardContent role="status" className="space-y-2 py-2 text-center">
            <p className="font-medium">Ikkinchi tasdiq vaqtincha olib tashlandi</p>
            <p className="text-5xl font-semibold tabular-nums" aria-live="polite">
              {Math.max(countdown, 1)}
            </p>
            <p className="text-sm text-muted-foreground">soniyadan keyin panel ochiladi</p>
          </CardContent>
        </Card>
      </main>
    );
  }
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Superadmin</CardTitle>
        </CardHeader>
        <CardContent>
          {challengeId ? (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                verify.mutate(values(event).code ?? '');
              }}
            >
              <p className="text-sm text-muted-foreground">
                Telegram’ga 6 xonali kod yuborildi. Kod 5 daqiqa amal qiladi.
              </p>
              <Field label="Kod">
                <Input
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  required
                  autoFocus
                />
              </Field>
              <ErrorText error={verify.error} />
              <Button type="submit" disabled={verify.isPending}>
                {verify.isPending ? 'Tekshirilmoqda…' : 'Tasdiqlash'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setChallengeId(null)}>
                Orqaga
              </Button>
            </form>
          ) : (
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
          )}
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
        <Input
          name="siteUrl"
          type="url"
          defaultValue={site?.siteUrl}
          placeholder="https://dokon-web.onrender.com"
          autoComplete="off"
          required
        />
      </Field>
      <Field label="API manzili">
        <Input
          name="apiUrl"
          type="url"
          defaultValue={site?.apiUrl}
          placeholder="https://dokon-api.onrender.com"
          autoComplete="off"
          required
        />
      </Field>
      {site ? null : (
        <Field label="Sayt kaliti">
          {/* Brauzer superadmin parolini bu yerga joylamasin: `new-password` avtomatik to'ldirishni o'chiradi. */}
          <Input
            name="apiToken"
            type="password"
            autoComplete="new-password"
            data-1p-ignore
            data-lpignore="true"
            minLength={32}
            required
          />
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
  const [amount, setAmount] = useState(site.agreedPrice);
  const preview = /^\d+(\.\d{1,2})?$/.test(amount)
    ? applyPayment({
        paidUntil: site.paidUntil,
        balance: site.balance,
        agreedPrice: site.agreedPrice,
        paidAt,
        amount,
      })
    : null;
  const pay = useMutation({
    mutationFn: (input: Record<string, string>) =>
      panelApi.addPayment(site.id, {
        amount: input.amount ?? '',
        paidAt: input.paidAt ?? '',
        note: input.note ?? null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: siteKey(site.id) });
      await queryClient.invalidateQueries();
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
        <Input
          name="amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value.replace(',', '.'))}
          inputMode="decimal"
          required
        />
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
        {preview === null ? (
          'Summani to‘g‘ri kiriting'
        ) : preview.months === 0 ? (
          <>
            Muddat uzaymaydi: balansga tushadi (
            {formatMoney(preview.balance, { withCurrency: true })}).
          </>
        ) : (
          <>
            {preview.months} oyga uzayadi. Keyingi to‘lov:{' '}
            <span className="font-medium text-foreground">{formatDate(preview.paidUntil)}</span>
            {preview.balance !== '0.00'
              ? `, balansda ${formatMoney(preview.balance, { withCurrency: true })} qoladi`
              : ''}
          </>
        )}
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
    await queryClient.invalidateQueries();
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

              <section className="grid gap-2">
                <h3 className="text-sm font-semibold">E’lon (saytda hamma ko‘radi)</h3>
                <AnnouncementForm siteId={id} />
              </section>

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
      await queryClient.invalidateQueries();
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
    {
      label: 'Shu oy kutilmoqda',
      value: formatMoney(data.expectedThisMonth, { withCurrency: true }),
    },
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

/**
 * Panelda faqat ikki holat (egasining qarori, 2026-11-09): "Hal qilindi" va "Javob berildi".
 * Javob kutayotgan murojaatda belgi yo'q — ular "N javobsiz" bilan sanaladi.
 */
function ticketBadge(ticket: ControlTicketDto): { label: string; className: string } | null {
  if (ticket.status === 'RESOLVED') {
    return { label: 'Hal qilindi', className: 'bg-emerald-500/15 text-emerald-500' };
  }
  if (ticket.replies.at(-1)?.author === 'SUPPORT') {
    return { label: 'Javob berildi', className: 'bg-amber-500/15 text-amber-500' };
  }
  return null;
}

function TicketBadge({ ticket }: { ticket: ControlTicketDto }) {
  const badge = ticketBadge(ticket);
  return badge ? <Badge className={badge.className}>{badge.label}</Badge> : null;
}

function TicketSheet({ ticket, onClose }: { ticket: ControlTicketDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['tickets'] });
  const reply = useMutation({
    mutationFn: (body: string) => panelApi.replyTicket(ticket.siteId, ticket.id, body),
    onSuccess: refresh,
  });
  const status = useMutation({
    mutationFn: (next: SupportStatus) => panelApi.ticketStatus(ticket.siteId, ticket.id, next),
    onSuccess: refresh,
  });
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            #{ticket.number} · {ticket.siteName}
          </SheetTitle>
        </SheetHeader>
        <div className="grid gap-4 px-4 pb-6 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt className="text-muted-foreground">Holat</dt>
            <dd>
              {ticketBadge(ticket) ? (
                <TicketBadge ticket={ticket} />
              ) : (
                <span className="text-muted-foreground">Javob kutilmoqda</span>
              )}
              {ticket.kind === 'AUTO' ? (
                <span className="ml-2 text-xs text-muted-foreground">
                  Avtomatik xato · {ticket.occurrences} marta
                </span>
              ) : null}
            </dd>
            <dt className="text-muted-foreground">Kim</dt>
            <dd>{ticket.userLogin ?? '—'}</dd>
            <dt className="text-muted-foreground">Qachon</dt>
            <dd>{formatTimestamp(ticket.createdAt)}</dd>
            {ticket.page ? (
              <>
                <dt className="text-muted-foreground">Sahifa</dt>
                <dd className="break-all">{ticket.page}</dd>
              </>
            ) : null}
            {ticket.errorCode ? (
              <>
                <dt className="text-muted-foreground">Xato kodi</dt>
                <dd>{ticket.errorCode}</dd>
              </>
            ) : null}
            {ticket.userAgent ? (
              <>
                <dt className="text-muted-foreground">Qurilma</dt>
                <dd className="text-xs break-all text-muted-foreground">{ticket.userAgent}</dd>
              </>
            ) : null}
          </dl>
          <p className="rounded-md bg-muted p-3 whitespace-pre-wrap">{ticket.message}</p>
          {ticket.replies.map((item) => (
            <div
              key={item.id}
              className={
                item.author === 'SUPPORT'
                  ? 'rounded-md border border-primary/30 bg-primary/5 p-3'
                  : 'rounded-md bg-muted p-3'
              }
            >
              <p className="mb-1 text-xs text-muted-foreground">
                {item.author === 'SUPPORT' ? 'Siz' : (ticket.userLogin ?? 'Foydalanuvchi')} ·{' '}
                {formatTimestamp(item.createdAt)}
              </p>
              <p className="whitespace-pre-wrap">{item.body}</p>
            </div>
          ))}
          {ticket.kind === 'MANUAL' ? (
            <form
              className="grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                reply.mutate(values(event).body ?? '', { onSuccess: () => form.reset() });
              }}
            >
              <Textarea name="body" rows={3} required maxLength={2000} placeholder="Javob…" />
              <Button type="submit" disabled={reply.isPending}>
                {reply.isPending ? 'Yuborilmoqda…' : 'Javob yuborish'}
              </Button>
              <ErrorText error={reply.error} />
            </form>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {ticket.status === 'RESOLVED' ? null : (
              <Button
                variant="outline"
                disabled={status.isPending}
                onClick={() => status.mutate('RESOLVED')}
              >
                Hal qilindi deb belgilash
              </Button>
            )}
          </div>
          <ErrorText error={status.error} />
          <section className="grid gap-2">
            <h3 className="font-semibold">Saytni ko‘rish</h3>
            <ViewAccess siteId={ticket.siteId} />
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TicketsSection() {
  const [selected, setSelected] = useState<string | null>(null);
  const { data, error } = useQuery({
    queryKey: ['tickets'],
    queryFn: panelApi.tickets,
    refetchInterval: 60_000,
  });
  const tickets = data?.tickets ?? [];
  const current = tickets.find((ticket) => ticket.id === selected);
  const waiting = tickets.filter((ticket) => ticketBadge(ticket) === null).length;
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        Murojaatlar
        {waiting > 0 ? (
          <Badge className="bg-primary/15 text-primary">{waiting} javobsiz</Badge>
        ) : null}
      </h2>
      <ErrorText error={error} />
      {data?.unreachable.length ? (
        <p className="text-xs text-muted-foreground">
          Javob bermagan saytlar: {data.unreachable.join(', ')}
        </p>
      ) : null}
      {tickets.length === 0 ? (
        <p className="text-sm text-muted-foreground">Hali murojaat yo‘q</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {tickets.slice(0, 30).map((ticket) => (
            <li key={`${ticket.siteId}-${ticket.id}`}>
              <button
                type="button"
                onClick={() => setSelected(ticket.id)}
                className="flex w-full items-start gap-3 p-3 text-left hover:bg-muted/50"
              >
                <span className="w-24 shrink-0">
                  {ticketBadge(ticket) ? (
                    <TicketBadge ticket={ticket} />
                  ) : (
                    <span
                      className="inline-block size-2 rounded-full bg-primary"
                      aria-label="Javobsiz"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    <span className="font-medium">
                      #{ticket.number} {ticket.siteName}
                    </span>{' '}
                    · {ticket.kind === 'AUTO' ? 'Avtomatik xato' : (ticket.userLogin ?? '—')}
                  </span>
                  <span className="block truncate text-muted-foreground">{ticket.message}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatTimestamp(ticket.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {current ? <TicketSheet ticket={current} onClose={() => setSelected(null)} /> : null}
    </section>
  );
}

function AnnouncementForm({ siteId }: { siteId: string }) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (input: { kind: 'INFO' | 'MAINTENANCE'; text: string } | null) =>
      panelApi.setAnnouncement(siteId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['events'] }),
  });
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const { kind, text } = values(event);
        save.mutate({ kind: kind === 'MAINTENANCE' ? 'MAINTENANCE' : 'INFO', text: text ?? '' });
      }}
    >
      <Textarea
        name="text"
        rows={2}
        required
        maxLength={500}
        placeholder="Masalan: Ertaga 10:00–11:00 da texnik ishlar"
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          name="kind"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          defaultValue="INFO"
          aria-label="E’lon turi"
        >
          <option value="INFO">Xabar</option>
          <option value="MAINTENANCE">Texnik ishlar</option>
        </select>
        <Button type="submit" disabled={save.isPending}>
          E’lon qilish
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={save.isPending}
          onClick={() => save.mutate(null)}
        >
          E’lonni olib tashlash
        </Button>
      </div>
      {save.isSuccess ? <p className="text-xs text-emerald-500">Saqlandi</p> : null}
      <ErrorText error={save.error} />
    </form>
  );
}

const BACKUP_STALE_MS = 36 * 3600_000;

/** Oxirgi bekap: yashil — 36 soat ichida muvaffaqiyatli, sariq — eski, qizil — xato yoki yo'q. */
function BackupBadge({
  health,
  checkedAt,
}: {
  health: ControlSiteHealthDto | undefined;
  /** Holat qachon olingan: bekap shu paytga nisbatan eski hisoblanadi. */
  checkedAt: number;
}) {
  if (!health) return <span className="text-xs text-muted-foreground">…</span>;
  if (!health.ok) return <span className="text-xs text-muted-foreground">Sayt javob bermadi</span>;
  const backup = health.backup;
  if (!backup) return <Badge className="bg-destructive/15 text-destructive">Bekap yo‘q</Badge>;
  const stale = checkedAt - Date.parse(backup.at) > BACKUP_STALE_MS;
  const className = !backup.ok
    ? 'bg-destructive/15 text-destructive'
    : stale
      ? 'bg-amber-500/15 text-amber-500'
      : 'bg-emerald-500/15 text-emerald-500';
  return (
    <span className="flex flex-col gap-0.5">
      <Badge className={className}>{backup.ok ? 'Bekap bor' : 'Bekap xato'}</Badge>
      <span className="text-xs text-muted-foreground">{formatTimestamp(backup.at)}</span>
    </span>
  );
}

function SitesScreen({ sites }: { sites: ControlSiteDto[] }) {
  const { data: health, dataUpdatedAt } = useQuery({
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
                <TableHead>Bekap</TableHead>
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
                  <TableCell>
                    <BackupBadge health={healthOf(site.id)} checkedAt={dataUpdatedAt} />
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
      <TicketsSection />
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
