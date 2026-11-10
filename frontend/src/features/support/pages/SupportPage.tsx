import { LICENSE_CONTACT_PHONE, type SupportTicketDto } from '@divine/shared';
import { CircleCheck, MessageSquare, Phone, Send, ThumbsDown, ThumbsUp } from 'lucide-react';
import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { t } from '@/i18n/uz';
import { PageHeader } from '@/shared/components/PageHeader';
import { SearchInput } from '@/shared/components/SearchInput';
import { ApiError } from '@/shared/lib/api-client';
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
      <SearchInput value={search} onChange={setSearch} placeholder={t.support.search} />
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.support.notFound}</p>
      ) : null}
      <div className="space-y-2">
        {items.map((item) => (
          <details key={item.id} className="group rounded-lg border bg-card p-4">
            <summary className="cursor-pointer font-medium">{item.question}</summary>
            <p className="mt-2 text-sm text-muted-foreground">{item.answer}</p>
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              {item.id in rated ? (
                <span>{t.support.thanks}</span>
              ) : (
                <>
                  <span>{t.support.helpful}</span>
                  {([true, false] as const).map((helpful) => (
                    <Button
                      key={String(helpful)}
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={helpful ? t.support.yes : t.support.no}
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
  const [failedText, setFailedText] = useState<string | null>(null);
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
          setFailedText(null);
          setSent(ticket.number);
        },
        onError: (error) => {
          // Limitga yetgan bo'lsa — sababi xabarda; aloqa uzilgan bo'lsa — "Yuborilmadi".
          if (error instanceof ApiError && error.status === 429) toastError(error);
          else setFailedText(message);
        },
      },
    );
  };
  if (sent) {
    return (
      <Card>
        <CardContent className="space-y-3 py-6 text-center">
          <CircleCheck className="mx-auto size-10 text-emerald-500" />
          <p className="font-medium">{t.support.sent(sent)}</p>
          <p className="text-sm text-muted-foreground">{t.support.sentHint}</p>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => setSent(null)}>
              {t.support.writeAgain}
            </Button>
            <Button onClick={onSent}>{t.support.myTickets}</Button>
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
            <Label htmlFor="support-message">{t.support.messageLabel}</Label>
            <Textarea
              id="support-message"
              name="message"
              rows={5}
              required
              maxLength={2000}
              placeholder={t.support.messagePlaceholder}
            />
            <p className="text-xs text-muted-foreground">{t.support.messageHint}</p>
          </div>
          {page || errorCode ? (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              {page ? t.support.page(page) : null}
              {page && errorCode ? ' · ' : null}
              {errorCode ? t.support.error(errorCode) : null}
            </p>
          ) : null}
          {failedText ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
              <StateBadge state="FAILED" />
              <span className="text-muted-foreground">{t.support.failedHint}</span>
            </div>
          ) : null}
          <Button type="submit" disabled={create.isPending}>
            <Send />
            {create.isPending ? t.support.sending : t.support.send}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

type MessageState = 'SENT' | 'FAILED' | 'ANSWERED' | 'RESOLVED';

const STATE_CLASS: Record<MessageState, string> = {
  SENT: 'bg-primary/15 text-primary',
  FAILED: 'bg-destructive/15 text-destructive',
  ANSWERED: 'bg-amber-500/15 text-amber-500',
  RESOLVED: 'bg-emerald-500/15 text-emerald-500',
};

function StateBadge({ state }: { state: MessageState }) {
  return <Badge className={STATE_CLASS[state]}>{t.support.state[state]}</Badge>;
}

/** Foydalanuvchi xabari. Holat xabarda emas — butun murojaat uchun bitta (sarlavhada). */
function UserBubble({
  body,
  meta,
  failed = false,
  action,
}: {
  body: string;
  meta: string;
  failed?: boolean;
  action?: ReactNode;
}) {
  return (
    <div
      className={
        failed
          ? 'rounded-md border border-destructive/30 bg-destructive/5 p-3'
          : 'rounded-md bg-muted p-3'
      }
    >
      <p className="mb-1 text-xs text-muted-foreground">{meta}</p>
      <p className="whitespace-pre-wrap">{body}</p>
      {action}
    </div>
  );
}

/**
 * Bitta murojaat — bitta holat (egasining qarori, 2026-11-10): ichidagi qo'shimcha savollar ham shu
 * holatga kiradi. Yuborilmagan xabar bo'lsa — "Yuborilmadi"; egasi yopgan — "Hal qilindi"; oxirgi xabar
 * egasiniki — "Javob berildi"; aks holda — "Yuborildi".
 */
function TicketCard({ ticket }: { ticket: SupportTicketDto }) {
  const reply = useReplyTicket();
  const [failed, setFailed] = useState<string[]>([]);
  const last = ticket.replies.at(-1);
  const headerState: MessageState =
    failed.length > 0
      ? 'FAILED'
      : ticket.status === 'RESOLVED'
        ? 'RESOLVED'
        : last?.author === 'SUPPORT'
          ? 'ANSWERED'
          : 'SENT';
  const send = (body: string, onSent?: () => void) =>
    reply.mutate(
      { id: ticket.id, body },
      {
        onSuccess: () => {
          setFailed((prev) => prev.filter((item) => item !== body));
          onSent?.();
        },
        onError: () => setFailed((prev) => (prev.includes(body) ? prev : [...prev, body])),
      },
    );
  return (
    <Card className="gap-3">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm">
          #{ticket.number} · {formatDateTime(ticket.createdAt)}
        </CardTitle>
        <StateBadge state={headerState} />
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <UserBubble
          body={ticket.message}
          meta={`${t.support.you} · ${formatDateTime(ticket.createdAt)}`}
        />
        {ticket.replies.map((item) =>
          item.author === 'SUPPORT' ? (
            <div key={item.id} className="rounded-md border border-primary/30 bg-primary/5 p-3">
              <p className="mb-1 text-xs text-muted-foreground">
                {t.support.supportName} · {formatDateTime(item.createdAt)}
              </p>
              <p className="whitespace-pre-wrap">{item.body}</p>
            </div>
          ) : (
            <UserBubble
              key={item.id}
              body={item.body}
              meta={`${t.support.you} · ${formatDateTime(item.createdAt)}`}
            />
          ),
        )}
        {failed.map((body) => (
          <UserBubble
            key={body}
            body={body}
            meta={t.support.failedHint}
            failed
            action={
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={reply.isPending}
                onClick={() => send(body)}
              >
                {t.support.retry}
              </Button>
            }
          />
        ))}
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const body = String(new FormData(form).get('body') ?? '').trim();
            if (!body) return;
            // Matn yuborilmasa ham yo'qolmaydi: "Yuborilmadi" xabarida qoladi.
            form.reset();
            send(body);
          }}
        >
          <Textarea
            name="body"
            rows={1}
            required
            maxLength={2000}
            placeholder={t.support.replyPlaceholder}
          />
          <Button
            type="submit"
            size="icon"
            aria-label={t.support.replySend}
            disabled={reply.isPending}
          >
            <Send />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function MineTab() {
  const { data, isPending } = useMyTickets();
  if (isPending) return <p className="text-sm text-muted-foreground">{t.support.loading}</p>;
  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">{t.support.noTickets}</p>;
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
          <CardTitle className="text-base">{t.support.contactTitle}</CardTitle>
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
            {t.support.telegram}
          </a>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.support.statusTitle}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {announcement?.kind === 'MAINTENANCE' ? (
            <p className="text-amber-500">{announcement.text}</p>
          ) : (
            <p className="flex items-center gap-2 text-emerald-500">
              <CircleCheck className="size-4" />
              {t.support.allGood}
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
      <PageHeader title={t.support.title} description={t.support.description} />
      {apiMode !== 'http' ? (
        <p className="text-sm text-muted-foreground">{t.support.demo}</p>
      ) : null}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="faq">{t.support.tabs.faq}</TabsTrigger>
          <TabsTrigger value="new">{t.support.tabs.new}</TabsTrigger>
          <TabsTrigger value="mine">{t.support.tabs.mine}</TabsTrigger>
          <TabsTrigger value="contact">{t.support.tabs.contact}</TabsTrigger>
          <TabsTrigger value="news">{t.support.tabs.news}</TabsTrigger>
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
