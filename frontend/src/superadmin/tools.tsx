import {
  type ControlLeadDto,
  type ControlLeadStatus,
  type ControlLoginOutcome,
  type ControlPaymentDto,
  type ControlSiteDto,
  type ControlSiteHealthDto,
  type SiteUserActivityDto,
} from '@divine/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, LogOut, Printer, Wrench } from 'lucide-react';
import { useState } from 'react';
import { formatDate, formatMoney, formatPhone, todayInTashkent } from '@/shared/lib/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Separator } from '@/shared/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Textarea } from '@/shared/ui/textarea';
import { panelApi } from './api';
import { ErrorText, formatTimestamp } from './common';
import { downloadXlsx } from './xlsx';

const MONTH_NAMES = [
  'Yan',
  'Fev',
  'Mar',
  'Apr',
  'May',
  'Iyn',
  'Iyl',
  'Avg',
  'Sen',
  'Okt',
  'Noy',
  'Dek',
];
const SITE_STATUS_TEXT = { ACTIVE: 'Faol', EXPIRING: 'Tugayapti', EXPIRED: 'Bloklangan' } as const;

/** "3 soat oldin": sayt ishlatilyaptimi — bir qarashda. */
export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return 'Hech qachon';
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 2) return 'Hozirgina';
  if (minutes < 60) return `${minutes} daqiqa oldin`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} soat oldin`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} kun oldin`;
  return formatTimestamp(iso);
}

const toNumber = (value: string) => Number(value);

/** Oxirgi 12 oy tushumi: oddiy ustunli grafik (kutubxonasiz). */
function RevenueChart() {
  const { data, error } = useQuery({ queryKey: ['revenue'], queryFn: panelApi.revenue });
  if (error) return <ErrorText error={error} />;
  if (!data) return null;
  const max = Math.max(...data.map((item) => toNumber(item.amount)), 1);
  const total = data.reduce((sum, item) => sum + toNumber(item.amount), 0);
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Oylik tushum</h3>
          <span className="text-sm text-muted-foreground">
            12 oyda: {formatMoney(total.toFixed(2), { withCurrency: true })}
          </span>
        </div>
        <div className="flex h-40 items-end gap-1.5" role="list" aria-label="Oylik tushum">
          {data.map((item) => {
            const amount = toNumber(item.amount);
            const [year, month] = item.month.split('-');
            const label = `${MONTH_NAMES[Number(month) - 1]} ${year}: ${formatMoney(item.amount, { withCurrency: true })}, ${item.payments} ta to‘lov`;
            return (
              <div
                key={item.month}
                role="listitem"
                title={label}
                aria-label={label}
                className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
              >
                <div
                  className={`w-full rounded-t ${amount > 0 ? 'bg-primary' : 'bg-muted'}`}
                  style={{ height: `${Math.max((amount / max) * 100, 2)}%` }}
                />
                <span className="text-[10px] text-muted-foreground">
                  {MONTH_NAMES[Number(month) - 1]}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/** Muddati o'tgan va shu oy to'lashi kerak bo'lgan saytlar. */
function Debtors({ sites }: { sites: ControlSiteDto[] }) {
  const month = todayInTashkent().slice(0, 7);
  const expired = sites.filter((site) => site.status === 'EXPIRED');
  const dueThisMonth = sites.filter(
    (site) => site.status !== 'EXPIRED' && site.paidUntil.slice(0, 7) <= month,
  );
  const row = (site: ControlSiteDto) => (
    <li key={site.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 p-3">
      <span className="min-w-0 flex-1">
        <span className="font-medium">{site.name}</span> · {site.ownerName}
        {site.ownerPhone ? (
          <a href={`tel:${site.ownerPhone}`} className="ml-2 text-muted-foreground underline">
            {formatPhone(site.ownerPhone)}
          </a>
        ) : null}
      </span>
      <span className="text-muted-foreground">{formatDate(site.paidUntil)}</span>
      <span className="font-medium tabular-nums">
        {formatMoney(site.amountDue, { withCurrency: true })}
      </span>
    </li>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Muddati o‘tganlar ({expired.length})</h3>
        {expired.length === 0 ? (
          <p className="text-sm text-muted-foreground">Yo‘q</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">{expired.map(row)}</ul>
        )}
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Bu oy to‘lashi kerak ({dueThisMonth.length})</h3>
        {dueThisMonth.length === 0 ? (
          <p className="text-sm text-muted-foreground">Yo‘q</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">{dueThisMonth.map(row)}</ul>
        )}
      </section>
    </div>
  );
}

/** Excel: to'lovlar va saytlar alohida varaqda. */
function ExportButton({ sites }: { sites: ControlSiteDto[] }) {
  const exportFile = useMutation({
    mutationFn: async () => {
      const payments = await panelApi.payments();
      downloadXlsx(`divine-${todayInTashkent()}.xlsx`, [
        {
          name: 'To‘lovlar',
          rows: [
            ['Sana', 'Sayt', 'Egasi', 'Summa (so‘m)', 'Shu kungacha', 'Izoh'],
            ...payments.map((payment) => [
              formatDate(payment.paidAt),
              payment.siteName,
              payment.ownerName,
              toNumber(payment.amount),
              formatDate(payment.paidUntil),
              payment.note,
            ]),
          ],
        },
        {
          name: 'Saytlar',
          rows: [
            [
              'Sayt',
              'Egasi',
              'Telefon',
              'Holat',
              'Keyingi to‘lov',
              'Kelishuv (so‘m)',
              'Balans (so‘m)',
              'Kerak (so‘m)',
              'Manzil',
            ],
            ...sites.map((site) => [
              site.name,
              site.ownerName,
              site.ownerPhone,
              SITE_STATUS_TEXT[site.status],
              formatDate(site.paidUntil),
              toNumber(site.agreedPrice),
              toNumber(site.balance),
              toNumber(site.amountDue),
              site.siteUrl,
            ]),
          ],
        },
      ]);
    },
  });
  return (
    <div className="grid gap-1">
      <Button variant="outline" disabled={exportFile.isPending} onClick={() => exportFile.mutate()}>
        <Download />
        {exportFile.isPending ? 'Tayyorlanmoqda…' : 'Excel’ga yuklab olish'}
      </Button>
      <ErrorText error={exportFile.error} />
    </div>
  );
}

export function MoneySection({ sites }: { sites: ControlSiteDto[] }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton sites={sites} />
      </div>
      <RevenueChart />
      <Debtors sites={sites} />
    </div>
  );
}

const LEAD_STATUS: Record<ControlLeadStatus, { label: string; className: string }> = {
  NEW: { label: 'Yangi', className: 'bg-primary/15 text-primary' },
  CALLED: { label: 'Qo‘ng‘iroq qilindi', className: 'bg-amber-500/15 text-amber-500' },
  CLIENT: { label: 'Mijoz bo‘ldi', className: 'bg-emerald-500/15 text-emerald-500' },
  REJECTED: { label: 'Rad etildi', className: 'bg-muted text-muted-foreground' },
};

function LeadRow({ lead }: { lead: ControlLeadDto }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState(lead.note ?? '');
  const update = useMutation({
    mutationFn: (input: { status?: ControlLeadStatus; note?: string | null }) =>
      panelApi.updateLead(lead.id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leads'] }),
  });
  return (
    <li className="grid gap-2 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">
          #{lead.number} {lead.name}
        </span>
        <a href={`tel:${lead.phone}`} className="underline tabular-nums">
          {formatPhone(lead.phone)}
        </a>
        {lead.username ? (
          <a
            href={`https://t.me/${lead.username}`}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground underline"
          >
            @{lead.username}
          </a>
        ) : null}
        <Badge className={LEAD_STATUS[lead.status].className}>
          {LEAD_STATUS[lead.status].label}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {formatTimestamp(lead.createdAt)}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <select
          value={lead.status}
          aria-label="Ariza holati"
          disabled={update.isPending}
          className="h-9 rounded-md border bg-background px-2 text-sm"
          onChange={(event) => update.mutate({ status: event.target.value as ControlLeadStatus })}
        >
          {Object.entries(LEAD_STATUS).map(([value, item]) => (
            <option key={value} value={value}>
              {item.label}
            </option>
          ))}
        </select>
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Izoh: nima kelishildi"
          maxLength={1000}
          aria-label="Izoh"
          className="min-w-40 flex-1"
        />
        <Button
          variant="outline"
          disabled={update.isPending || note === (lead.note ?? '')}
          onClick={() => update.mutate({ note: note.trim() || null })}
        >
          Saqlash
        </Button>
      </div>
      <ErrorText error={update.error} />
    </li>
  );
}

export function LeadsSection() {
  const { data, error } = useQuery({
    queryKey: ['leads'],
    queryFn: panelApi.leads,
    refetchInterval: 60_000,
  });
  const open = data?.filter((lead) => lead.status === 'NEW').length ?? 0;
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        Bepul sinab ko‘rish arizalari
        {open > 0 ? <Badge className="bg-primary/15 text-primary">{open} yangi</Badge> : null}
      </h2>
      <p className="text-xs text-muted-foreground">
        Botda «Bepul sinab ko‘rish» bosganlar ismi va telefonini qoldiradi:{' '}
        <a href="https://t.me/divine_uzbot" target="_blank" rel="noreferrer" className="underline">
          @divine_uzbot
        </a>
      </p>
      <ErrorText error={error} />
      {data && data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Hali ariza yo‘q</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {data?.map((lead) => (
            <LeadRow key={lead.id} lead={lead} />
          ))}
        </ul>
      )}
    </section>
  );
}

const LOGIN_OUTCOME: Record<ControlLoginOutcome, { label: string; className: string }> = {
  SUCCESS: { label: 'Kirdi', className: 'bg-emerald-500/15 text-emerald-500' },
  CODE_SENT: { label: 'Kod yuborildi', className: 'bg-muted text-muted-foreground' },
  BAD_PASSWORD: { label: 'Parol noto‘g‘ri', className: 'bg-destructive/15 text-destructive' },
  BAD_CODE: { label: 'Kod noto‘g‘ri', className: 'bg-destructive/15 text-destructive' },
};

export function LoginsSection() {
  const { data, error } = useQuery({ queryKey: ['logins'], queryFn: panelApi.logins });
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Superadmin kirishlar tarixi</h2>
      <p className="text-xs text-muted-foreground">
        Yangi qurilmadan kirilsa yoki parol/kod noto‘g‘ri kiritilsa, Telegram’ga ogohlantirish
        keladi.
      </p>
      <ErrorText error={error} />
      {data && data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Hali yozuv yo‘q</p>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vaqt</TableHead>
                  <TableHead>Natija</TableHead>
                  <TableHead>Qurilma</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.map((login) => (
                  <TableRow key={login.id}>
                    <TableCell className="tabular-nums">
                      {formatTimestamp(login.occurredAt)}
                    </TableCell>
                    <TableCell>
                      <Badge className={LOGIN_OUTCOME[login.outcome].className}>
                        {LOGIN_OUTCOME[login.outcome].label}
                      </Badge>
                      {login.newDevice ? (
                        <Badge className="ml-1 bg-amber-500/15 text-amber-500">
                          Yangi qurilma
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>{login.device}</TableCell>
                    <TableCell className="font-mono text-xs">{login.ip ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

const ROLE_LABEL: Record<string, string> = { ADMIN: 'Admin', USER: 'Sotuvchi' };

function UserActivity({ users }: { users: SiteUserActivityDto[] }) {
  if (users.length === 0) return <p className="text-sm text-muted-foreground">Foydalanuvchi yo‘q</p>;
  return (
    <ul className="divide-y rounded-lg border text-sm">
      {users.map((user) => (
        <li key={user.login} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 p-3">
          <span className="min-w-0 flex-1">
            <span className="font-medium">{user.fullName ?? user.login}</span>{' '}
            <span className="text-muted-foreground">
              ({user.login}, {ROLE_LABEL[user.role] ?? user.role})
            </span>
            {user.active ? null : (
              <Badge className="ml-2 bg-muted text-muted-foreground">Bloklangan</Badge>
            )}
          </span>
          <span
            className="text-xs text-muted-foreground"
            title={user.lastSeenAt ? formatTimestamp(user.lastSeenAt) : undefined}
          >
            {timeAgo(user.lastSeenAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Sayt ishlatilyaptimi: sonlar va kim oxirgi marta qachon kirgan. */
export function SiteStats({ siteId }: { siteId: string }) {
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ['stats', siteId],
    queryFn: () => panelApi.stats(siteId),
  });
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Sayt ishlatilyaptimi</h3>
        <Button variant="ghost" size="sm" disabled={isFetching} onClick={() => void refetch()}>
          {isFetching ? 'Yuklanmoqda…' : 'Yangilash'}
        </Button>
      </div>
      <ErrorText error={error} />
      {data ? (
        <>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            {[
              ['Bugun sotuv', data.sales.today],
              ['30 kunda sotuv', data.sales.last30Days],
              ['Jami sotuv', data.sales.total],
              ['Mahsulotlar', data.products],
              ['Mijozlar', data.customers],
              ['Omborlar', data.warehouses],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border p-2">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-lg font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">
            Oxirgi sotuv: {timeAgo(data.sales.lastAt)}
          </p>
          <h4 className="text-xs font-semibold text-muted-foreground">
            Foydalanuvchilar: oxirgi faollik
          </h4>
          <UserActivity users={data.users} />
        </>
      ) : null}
    </section>
  );
}

/** Versiya, texnik ishlar va hammani chiqarish. */
export function SiteTools({
  siteId,
  health,
}: {
  siteId: string;
  health: ControlSiteHealthDto | undefined;
}) {
  const queryClient = useQueryClient();
  const maintenance = health?.maintenance;
  const [message, setMessage] = useState('');
  const [confirmLogout, setConfirmLogout] = useState(false);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['health'] });
    await queryClient.invalidateQueries({ queryKey: ['events'] });
  };
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      panelApi.setMaintenance(siteId, { enabled, message: enabled ? message : null }),
    onSuccess: refresh,
  });
  const logoutAll = useMutation({
    mutationFn: () => panelApi.revokeSessions(siteId),
    onSuccess: async () => {
      setConfirmLogout(false);
      await refresh();
    },
  });
  return (
    <section className="grid gap-3">
      <h3 className="text-sm font-semibold">Masofadan boshqarish</h3>
      <p className="text-xs text-muted-foreground">
        Versiya:{' '}
        {health?.version ? (
          <>
            <span className="font-mono">{health.version.commit ?? 'noma’lum'}</span>, server{' '}
            {formatTimestamp(health.version.startedAt)} da ishga tushgan
          </>
        ) : health && !health.ok ? (
          'sayt javob bermadi'
        ) : (
          '…'
        )}
      </p>

      <div className="grid gap-2 rounded-lg border p-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Wrench className="size-4" />
          Texnik ishlar rejimi
          {maintenance?.enabled ? (
            <Badge className="bg-amber-500/15 text-amber-500">Yoqilgan</Badge>
          ) : null}
        </p>
        {maintenance?.enabled ? (
          <>
            <p className="text-sm text-muted-foreground">
              Foydalanuvchilar kira olmaydi
              {maintenance.message ? `: «${maintenance.message}»` : ''}.
            </p>
            <Button disabled={toggle.isPending} onClick={() => toggle.mutate(false)}>
              Texnik ishlarni tugatish
            </Button>
          </>
        ) : (
          <>
            <Textarea
              rows={2}
              maxLength={300}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Xabar (ixtiyoriy): masalan, 30 daqiqada tugaydi"
              aria-label="Texnik ishlar xabari"
            />
            <Button
              variant="outline"
              disabled={toggle.isPending || !health?.ok}
              onClick={() => toggle.mutate(true)}
            >
              Texnik ishlarni boshlash
            </Button>
          </>
        )}
        <ErrorText error={toggle.error} />
      </div>

      <div className="grid gap-2 rounded-lg border p-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <LogOut className="size-4" />
          Hammani tizimdan chiqarish
        </p>
        <p className="text-sm text-muted-foreground">
          Parol sizib ketsa: saytdagi hamma foydalanuvchi qaytadan kirishi kerak bo‘ladi.
        </p>
        {confirmLogout ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              disabled={logoutAll.isPending}
              onClick={() => logoutAll.mutate()}
            >
              {logoutAll.isPending ? 'Chiqarilmoqda…' : 'Ha, hammani chiqarish'}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmLogout(false)}>
              Bekor qilish
            </Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setConfirmLogout(true)}>
            Hammani chiqarish
          </Button>
        )}
        {logoutAll.data ? (
          <p role="status" className="text-sm text-emerald-500">
            {logoutAll.data.revoked} ta sessiya yopildi.
          </p>
        ) : null}
        <ErrorText error={logoutAll.error} />
      </div>
    </section>
  );
}

/** To'lov kvitansiyasi: chop etish oynasida "PDF sifatida saqlash" — mijozga yuboriladi. */
export function ReceiptDialog({
  site,
  payment,
  number,
  onClose,
}: {
  site: ControlSiteDto;
  payment: ControlPaymentDto;
  /** Saytdagi to'lov tartib raqami (eng birinchisi — 1). */
  number: number;
  onClose: () => void;
}) {
  const rows: [string, string][] = [
    ['Kvitansiya raqami', `${site.name.slice(0, 3).toUpperCase()}-${String(number).padStart(4, '0')}`],
    ['To‘langan sana', formatDate(payment.paidAt)],
    ['Mijoz', site.ownerName],
    ...(site.ownerPhone ? ([['Telefon', formatPhone(site.ownerPhone)]] as [string, string][]) : []),
    ['Sayt', site.siteUrl.replace(/^https?:\/\//, '')],
    ['Xizmat', 'Divine dasturidan foydalanish'],
    ['Amal qiladi', `${formatDate(payment.paidUntil)} gacha`],
    ...(payment.note ? ([['Izoh', payment.note]] as [string, string][]) : []),
  ];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="receipt-print receipt-wide sm:max-w-lg">
        <DialogHeader className="items-center text-center">
          <DialogTitle>To‘lov kvitansiyasi</DialogTitle>
          <DialogDescription>Divine.uz · +998 90 133 38 31</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right">{value}</dd>
            </div>
          ))}
        </dl>
        <Separator />
        <p className="flex items-baseline justify-between text-base">
          <span>To‘langan summa</span>
          <span className="text-xl font-semibold tabular-nums">
            {formatMoney(payment.amount, { withCurrency: true })}
          </span>
        </p>
        <p className="text-center text-xs text-muted-foreground">To‘lov uchun rahmat!</p>
        <Button onClick={() => window.print()} className="print:hidden">
          <Printer />
          Chop etish / PDF
        </Button>
        <p className="text-center text-xs text-muted-foreground print:hidden">
          PDF uchun chop etish oynasida «PDF sifatida saqlash»ni tanlang.
        </p>
      </DialogContent>
    </Dialog>
  );
}

export { FileText as ReceiptIcon };
