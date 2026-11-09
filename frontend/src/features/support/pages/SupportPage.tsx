import { LICENSE_CONTACT_PHONE, type SupportTicketDto } from '@divine/shared';
import { CircleCheck, MessageSquare, Phone, Send, ThumbsDown, ThumbsUp } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { PageHeader } from '@/shared/components/PageHeader';
import { SearchInput } from '@/shared/components/SearchInput';
import { apiMode } from '@/shared/lib/api-mode';
import { TELEGRAM_URL } from '@/shared/lib/contacts';
import { formatDateTime } from '@/shared/lib/format';
import { toastError } from '@/shared/lib/mutation';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Label } from '@/shared/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { Textarea } from '@/shared/ui/textarea';
import {
  sendFeedback,
  useAnnouncement,
  useCreateTicket,
  useMyTickets,
  useReplyTicket,
} from '../api/support';
import { CHANGELOG, FAQ } from '../content';

const TABS = ['faq', 'new', 'mine', 'contact', 'news'] as const;
type Tab = (typeof TABS)[number];

const STATUS: Record<SupportTicketDto['status'], { label: string; className: string }> = {
  NEW: { label: 'Yuborildi', className: 'bg-primary/15 text-primary' },
  SEEN: { label: 'Ko‘rildi', className: 'bg-amber-500/15 text-amber-500' },
  RESOLVED: { label: 'Hal qilindi', className: 'bg-emerald-500/15 text-emerald-500' },
};

function FaqTab() {
  const [search, setSearch] = useState('');
  const [rated, setRated] = useState<Record<string, boolean>>({});
  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? FAQ.filter((item) => `${item.question} ${item.answer}`.toLowerCase().includes(q))
      : FAQ;
  }, [search]);
  return (
    <div className="space-y-4">
      <SearchInput value={search} onChange={setSearch} placeholder="Savolni qidiring…" />
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Javob topilmadi. "Murojaat yuborish" bo‘limida savolingizni yozing.
        </p>
      ) : null}
      <div className="space-y-2">
        {items.map((item) => (
          <details key={item.id} className="group rounded-lg border bg-card p-4">
            <summary className="cursor-pointer font-medium">{item.question}</summary>
            <p className="mt-2 text-sm text-muted-foreground">{item.answer}</p>
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              {item.id in rated ? (
                <span>Rahmat, bahoingiz qabul qilindi</span>
              ) : (
                <>
                  <span>Yordam berdimi?</span>
                  {([true, false] as const).map((helpful) => (
                    <Button
                      key={String(helpful)}
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={helpful ? 'Ha' : 'Yo‘q'}
                      onClick={() => {
                        sendFeedback(item.id, helpful);
                        setRated((prev) => ({ ...prev, [item.id]: helpful }));
                      }}
                    >
                      {helpful ? <ThumbsUp /> : <ThumbsDown />}
                    </Button>
                  ))}
                </>
              )}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function NewTicketTab({ onSent }: { onSent: () => void }) {
  const [params] = useSearchParams();
  const create = useCreateTicket();
  const [sent, setSent] = useState<string | null>(null);
  const page = params.get('page') ?? undefined;
  const errorCode = params.get('code') ?? undefined;
  const requestId = params.get('request') ?? undefined;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = String(new FormData(form).get('message') ?? '');
    create.mutate(
      { message, page, errorCode, requestId },
      {
        onSuccess: (ticket) => {
          form.reset();
          setSent(ticket.number);
        },
        onError: toastError,
      },
    );
  };
  if (sent) {
    return (
      <Card>
        <CardContent className="space-y-3 py-6 text-center">
          <CircleCheck className="mx-auto size-10 text-emerald-500" />
          <p className="font-medium">Murojaatingiz #{sent} yuborildi</p>
          <p className="text-sm text-muted-foreground">
            Tez orada javob beramiz. Javob "Mening murojaatlarim"da ko‘rinadi.
          </p>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => setSent(null)}>
              Yana yozish
            </Button>
            <Button onClick={onSent}>Murojaatlarim</Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="pt-6">
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="support-message">Muammo yoki savol</Label>
            <Textarea
              id="support-message"
              name="message"
              rows={5}
              required
              maxLength={2000}
              placeholder="Masalan: Sotuvni yopganda xato chiqdi"
            />
            <p className="text-xs text-muted-foreground">
              Sahifa, xato kodi va qurilmangiz haqida ma’lumot o‘zi qo‘shiladi. Parol yozmang.
            </p>
          </div>
          {page || errorCode ? (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              {page ? `Sahifa: ${page}` : null}
              {page && errorCode ? ' · ' : null}
              {errorCode ? `Xato: ${errorCode}` : null}
            </p>
          ) : null}
          <Button type="submit" disabled={create.isPending}>
            <Send />
            {create.isPending ? 'Yuborilmoqda…' : 'Yuborish'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function TicketCard({ ticket }: { ticket: SupportTicketDto }) {
  const reply = useReplyTicket();
  return (
    <Card className="gap-3">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm">
          #{ticket.number} · {formatDateTime(ticket.createdAt)}
        </CardTitle>
        <Badge className={STATUS[ticket.status].className}>{STATUS[ticket.status].label}</Badge>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="whitespace-pre-wrap">{ticket.message}</p>
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
              {item.author === 'SUPPORT' ? 'Divine yordam' : 'Siz'} ·{' '}
              {formatDateTime(item.createdAt)}
            </p>
            <p className="whitespace-pre-wrap">{item.body}</p>
          </div>
        ))}
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const body = String(new FormData(form).get('body') ?? '');
            reply.mutate(
              { id: ticket.id, body },
              { onSuccess: () => form.reset(), onError: toastError },
            );
          }}
        >
          <Textarea name="body" rows={1} required maxLength={2000} placeholder="Javob yozish…" />
          <Button type="submit" size="icon" aria-label="Javob yuborish" disabled={reply.isPending}>
            <Send />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function MineTab() {
  const { data, isPending } = useMyTickets();
  if (isPending) return <p className="text-sm text-muted-foreground">Yuklanmoqda…</p>;
  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">Hali murojaat yo‘q.</p>;
  }
  return (
    <div className="space-y-3">
      {data.map((ticket) => (
        <TicketCard key={ticket.id} ticket={ticket} />
      ))}
    </div>
  );
}

function ContactTab() {
  const { data: announcement } = useAnnouncement();
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bog‘lanish</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <a
            className="flex items-center gap-2 font-medium text-primary"
            href={`tel:${LICENSE_CONTACT_PHONE}`}
          >
            <Phone className="size-4" />
            {LICENSE_CONTACT_PHONE}
          </a>
          <a
            className="flex items-center gap-2 font-medium text-primary"
            href={TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageSquare className="size-4" />
            Telegram
          </a>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tizim holati</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {announcement?.kind === 'MAINTENANCE' ? (
            <p className="text-amber-500">{announcement.text}</p>
          ) : (
            <p className="flex items-center gap-2 text-emerald-500">
              <CircleCheck className="size-4" />
              Hammasi ishlayapti
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NewsTab() {
  return (
    <div className="space-y-3">
      {CHANGELOG.map((entry) => (
        <Card key={entry.id} className="gap-2">
          <CardHeader>
            <CardTitle className="text-base">
              {entry.title}{' '}
              <span className="text-sm font-normal text-muted-foreground">· {entry.date}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {entry.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Murojaat bo'limi (egasining qarori, 2026-11-09). */
export function SupportPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : 'faq';
  const setTab = (next: string) =>
    setParams(next === 'faq' ? {} : { tab: next }, { replace: true });
  return (
    <>
      <PageHeader
        title="Murojaat"
        description="Savol-javoblar, muammo haqida xabar berish va murojaatlaringizga javoblar"
      />
      {apiMode !== 'http' ? (
        <p className="text-sm text-muted-foreground">
          Demo rejimda murojaat yuborilmaydi: savol-javoblar va yangiliklar ishlaydi.
        </p>
      ) : null}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="faq">Savol-javoblar</TabsTrigger>
          <TabsTrigger value="new">Murojaat yuborish</TabsTrigger>
          <TabsTrigger value="mine">Mening murojaatlarim</TabsTrigger>
          <TabsTrigger value="contact">Bog‘lanish</TabsTrigger>
          <TabsTrigger value="news">Yangiliklar</TabsTrigger>
        </TabsList>
        <TabsContent value="faq">
          <FaqTab />
        </TabsContent>
        <TabsContent value="new">
          <NewTicketTab onSent={() => setTab('mine')} />
        </TabsContent>
        <TabsContent value="mine">
          <MineTab />
        </TabsContent>
        <TabsContent value="contact">
          <ContactTab />
        </TabsContent>
        <TabsContent value="news">
          <NewsTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
