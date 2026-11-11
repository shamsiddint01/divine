import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  CONTROL_LEAD_STATUSES,
  type ControlLeadStatus,
  type ControlSiteDto,
  DEMO_TRIAL_DAYS,
  DEMO_TRIAL_MINUTES,
} from '@divine/shared';
import { Clock } from '../../common/time/clock.js';
import { InjectConfig } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { SupportService } from '../support/support.service.js';
import { PublicTelegramService, TelegramService } from '../telegram/telegram.service.js';
import { ControlService, LEAD_STATUS_LABEL } from './control.service.js';
import { SiteClient } from './site-client.js';

/** Ariza suhbati: ism → telefon. Bir soatda tugatilmasa, qaytadan boshlanadi. */
const leadKey = (chatId: string) => `divine:control:lead:${chatId}`;
const LEAD_TTL_SECONDS = 60 * 60;
/** Telegram javob kutmasdan qayta yuborgan yangilanish ikki marta bajarilmasin. */
const updateKey = (id: number) => `divine:control:public-update:${id}`;
const UPDATE_TTL_SECONDS = 24 * 60 * 60;
/** Demo sayt shuncha vaqtda uyg'onmasa, mijozga "kuting" deb yoziladi. */
const WAKE_NOTICE_MS = 5_000;
/** Bir chatdan bir kunda bitta ariza: takror bosish va spamdan himoya. */
const LEAD_REPEAT_MS = 24 * 3_600_000;
const CONTACT_PHONE = '+998901333831';
const CONTACT_BUTTON = '📱 Raqamni yuborish';

interface LeadState {
  step: 'name' | 'phone';
  name?: string;
}

interface Chat {
  id: number;
  type?: string;
}

interface Message {
  text?: string;
  chat?: Chat;
  contact?: { phone_number?: string };
  from?: { username?: string };
}

interface Callback {
  id: string;
  data?: string;
  message?: { chat?: Chat };
}

/** +998 bilan: 9 xonali mahalliy raqam yoki 7–15 xonali xalqaro. Aks holda `null`. */
export function normalizeLeadPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 9) return `+998${digits}`;
  if (digits.length >= 7 && digits.length <= 15) return `+${digits}`;
  return null;
}

/**
 * Superadmin boti (egasining qarori, 2026-11-10). Begonalar uchun — bepul sinab ko'rish arizasi
 * (ism va telefon). Egasi uchun — `/bugun`, `/qarzdorlar`, `/saytlar`, `/arizalar`, `/blokla`.
 * Murojaatlarga javob (`/murojaatlar`) SupportService'da qoladi.
 */
@Injectable()
export class ControlBotService implements OnModuleInit {
  constructor(
    private readonly support: SupportService,
    private readonly telegram: TelegramService,
    private readonly publicBot: PublicTelegramService,
    private readonly control: ControlService,
    private readonly sites: SiteClient,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly clock: Clock,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (this.config.CONTROL_PANEL_ENABLED) {
      this.support.addTelegramHandler((update) => this.handle(update));
    }
  }

  async handle(update: unknown): Promise<boolean> {
    if (!this.telegram.enabled) return false;
    const callback = (update as { callback_query?: Callback } | null)?.callback_query;
    if (callback) return this.callback(callback);
    const message = (update as { message?: Message } | null)?.message;
    if (!message?.chat) return false;
    if (this.telegram.isOwnerChat(message.chat.id)) return this.ownerCommand(message.text ?? '');
    // Mijozlar boti ulangan bo'lsa, egasining botiga begonalar yozganda javob yo'q (bot sir saqlanadi).
    if (message.chat.type !== 'private' || this.publicBot.enabled) return true;
    await this.lead(message, this.telegram);
    return true;
  }

  /**
   * Mijozlar boti (`@divine_uzbot`): har kim — egasi ham — oddiy mijoz sifatida ariza qoldiradi.
   * Egasiga bildirishnomalar egasining botiga boradi.
   */
  async handlePublic(update: unknown): Promise<void> {
    if (!this.publicBot.enabled) return;
    const id = (update as { update_id?: unknown } | null)?.update_id;
    if (typeof id === 'number') {
      const fresh = await this.redis.client.set(updateKey(id), '1', 'EX', UPDATE_TTL_SECONDS, 'NX');
      if (!fresh) return;
    }
    const message = (update as { message?: Message } | null)?.message;
    if (!message?.chat || message.chat.type !== 'private') return;
    await this.lead(message, this.publicBot);
  }

  /**
   * Telegram'ga darhol javob: demo sayt uyg'onishi (bepul server, ~1 daqiqa) Telegram kutadigan
   * vaqtdan uzun. Aks holda Telegram xabarni qayta yuboradi va mijoz chalkash javob oladi.
   */
  handlePublicInBackground(update: unknown): void {
    const job = this.handlePublic(update)
      .catch((error: unknown) => this.logger.error(error, 'Mijozlar boti xabari bajarilmadi'))
      .finally(() => this.background.delete(job));
    this.background.add(job);
  }

  /** Testlar uchun: fonda ishlayotgan xabarlar tugashini kutish. */
  async idle(): Promise<void> {
    while (this.background.size > 0) await Promise.all([...this.background]);
  }

  private async callback(callback: Callback): Promise<boolean> {
    if (!this.telegram.isOwnerChat(callback.message?.chat?.id)) return true;
    const data = callback.data ?? '';
    const lead = /^lead:([A-Z]+):([0-9a-f-]{36})$/.exec(data);
    const block = /^block(-yes)?:([0-9a-f-]{36})$/.exec(data);
    if (!lead && !block && data !== 'block-no') return false;
    await this.telegram.answerCallback(callback.id).catch(() => undefined);
    if (lead) {
      const status = lead[1] as ControlLeadStatus;
      if (!CONTROL_LEAD_STATUSES.includes(status)) return true;
      const row = await this.control.updateLead(lead[2]!, { status }).catch(() => null);
      await this.say(
        row
          ? `Ariza #${row.number} (${row.name}): ${LEAD_STATUS_LABEL[status]}.`
          : 'Ariza topilmadi.',
      );
      return true;
    }
    if (!block) {
      await this.say('Bekor qilindi.');
      return true;
    }
    const site = (await this.control.list()).find((item) => item.id === block[2]);
    if (!site) {
      await this.say('Sayt topilmadi.');
      return true;
    }
    if (!block[1]) {
      await this.telegram.send(
        site.manualBlock
          ? `${site.name} saytini ochasizmi? Foydalanuvchilar yana kira oladi.`
          : `${site.name} saytini bloklaysizmi? Foydalanuvchilar kira olmaydi.`,
        {
          buttons: [
            [
              {
                text: site.manualBlock ? '🔓 Ha, ochish' : '🔒 Ha, bloklash',
                data: `block-yes:${site.id}`,
              },
              { text: 'Yo‘q', data: 'block-no' },
            ],
          ],
        },
      );
      return true;
    }
    const updated = await this.control.update(site.id, { manualBlock: !site.manualBlock });
    await this.say(
      `${updated.manualBlock ? '🔒' : '🔓'} ${updated.name} ${updated.manualBlock ? 'bloklandi' : 'ochildi'}.` +
        (updated.synced ? '' : '\nSayt hozir javob bermadi: panelda «Qayta yuborish»ni bosing.'),
    );
    return true;
  }

  private async ownerCommand(text: string): Promise<boolean> {
    const command = /^\/([a-z]+)/.exec(text.trim())?.[1];
    switch (command) {
      case 'bugun':
        await this.say(await this.control.report('today'));
        return true;
      case 'qarzdorlar':
        await this.say(this.debtors(await this.control.list()));
        return true;
      case 'saytlar':
        await this.say(await this.sitesText());
        return true;
      case 'arizalar':
        await this.sendLeads();
        return true;
      case 'blokla':
        await this.sendBlockList();
        return true;
      default:
        return false;
    }
  }

  private debtors(sites: ControlSiteDto[]): string {
    const due = sites
      .filter((site) => site.status !== 'ACTIVE')
      .sort((a, b) => a.daysLeft - b.daysLeft);
    if (due.length === 0) return 'Qarzdor yo‘q: hamma saytning muddati bor.';
    return [
      'Qarzdorlar:',
      ...due.map(
        (site) =>
          `${site.status === 'EXPIRED' ? '⛔' : '⏰'} ${site.name} — ${site.ownerName}` +
          `${site.ownerPhone ? `, ${site.ownerPhone}` : ''}\n` +
          `   muddat ${site.paidUntil.split('-').reverse().join('.')}, kerak ${Number(site.amountDue).toLocaleString('ru-RU')} so‘m`,
      ),
    ].join('\n');
  }

  private async sitesText(): Promise<string> {
    const [sites, health] = await Promise.all([this.control.list(), this.control.health()]);
    if (sites.length === 0) return 'Sayt yo‘q.';
    const byId = new Map(health.map((item) => [item.id, item]));
    const label = { ACTIVE: 'faol', EXPIRING: 'muddati yaqin', EXPIRED: 'bloklangan' } as const;
    return [
      'Saytlar:',
      ...sites.map((site) => {
        const state = byId.get(site.id);
        const up = state?.ok ? '🟢' : '🔴';
        const extra = [
          label[site.status],
          site.manualBlock ? 'qo‘lda yopilgan' : null,
          state?.maintenance?.enabled ? 'texnik ishlar' : null,
          `${site.daysLeft} kun`,
          state?.version?.commit ? `v.${state.version.commit}` : null,
        ].filter(Boolean);
        return `${up} ${site.name}: ${extra.join(', ')}`;
      }),
    ].join('\n');
  }

  private async sendLeads(): Promise<void> {
    const leads = (await this.control.leads()).filter(
      (lead) => lead.status === 'NEW' || lead.status === 'CALLED',
    );
    if (leads.length === 0) {
      await this.say('Ochiq ariza yo‘q.');
      return;
    }
    for (const lead of leads.slice(0, 10)) {
      await this.telegram.send(this.leadText(lead, LEAD_STATUS_LABEL[lead.status]), {
        buttons: this.leadButtons(lead.id),
      });
    }
  }

  private leadText(
    lead: { number: string; name: string; phone: string; username: string | null },
    status: string,
  ): string {
    return (
      `📝 Ariza #${lead.number} (${status})\nIsm: ${lead.name}\nTelefon: ${lead.phone}` +
      (lead.username ? `\nTelegram: @${lead.username}` : '')
    );
  }

  private leadButtons(id: string) {
    return [
      [
        { text: '📞 Qo‘ng‘iroq qilindi', data: `lead:CALLED:${id}` },
        { text: '✅ Mijoz bo‘ldi', data: `lead:CLIENT:${id}` },
      ],
      [{ text: '❌ Rad etildi', data: `lead:REJECTED:${id}` }],
    ];
  }

  private async sendBlockList(): Promise<void> {
    const sites = await this.control.list();
    if (sites.length === 0) {
      await this.say('Sayt yo‘q.');
      return;
    }
    await this.telegram.send('Qaysi saytni bloklaysiz yoki ochasiz?', {
      buttons: sites.map((site) => [
        {
          text: site.manualBlock ? `🔓 ${site.name} (yopiq)` : `🔒 ${site.name}`,
          data: `block:${site.id}`,
        },
      ]),
    });
  }

  /** Bepul sinab ko'rish arizasi: /start → ism → telefon (tugma yoki matn). */
  private async lead(message: Message, bot: TelegramService): Promise<void> {
    const chatId = String(message.chat!.id);
    const key = leadKey(chatId);
    const text = message.text?.trim() ?? '';
    const send = (body: string, options: { askContact?: string; removeKeyboard?: boolean } = {}) =>
      bot.send(body, { chatId, ...options }).catch(() => undefined);

    if (text.startsWith('/start')) {
      const trial = await this.trialOf({ chatId });
      if (trial) {
        await send(this.trialAlready(trial));
        return;
      }
      const recent = await this.recentLead(chatId);
      if (recent) {
        // Ariza bor-u, sinov hisobi hali berilmagan (demo sayt keyin ulangan yoki javob bermagan edi).
        if (await this.issueTrial(recent, send)) return;
        await send(
          `Arizangiz qabul qilingan (#${recent.number}). Tez orada bog‘lanamiz.\n` +
            `Savol bo‘lsa: ${CONTACT_PHONE}`,
        );
        return;
      }
      await this.redis.client.set(key, JSON.stringify({ step: 'name' }), 'EX', LEAD_TTL_SECONDS);
      await send(
        'Assalomu alaykum! Divine — do‘kon va omborlar uchun dastur: sotuv, ombor, nasiya va hisobotlar.\n\n' +
          'Bepul sinab ko‘rish uchun ism va familiyangizni yozing (masalan: Ali Valiyev).',
      );
      return;
    }

    const raw = await this.redis.client.get(key);
    const state = raw ? (JSON.parse(raw) as LeadState) : null;
    if (!state) {
      await send(`Bepul sinab ko‘rish uchun /start ni bosing.\nSavol bo‘lsa: ${CONTACT_PHONE}`);
      return;
    }

    if (state.step === 'name') {
      const name = text.replace(/\s+/g, ' ').slice(0, 120);
      if (name.length < 3 || name.startsWith('/') || !name.includes(' ')) {
        await send('Ism va familiyangizni birga yozing. Masalan: Ali Valiyev');
        return;
      }
      await this.redis.client.set(
        key,
        JSON.stringify({ step: 'phone', name } satisfies LeadState),
        'EX',
        LEAD_TTL_SECONDS,
      );
      await send(
        `Rahmat, ${name}! Endi telefon raqamingizni yuboring: pastdagi tugmani bosing yoki yozing.`,
        { askContact: CONTACT_BUTTON },
      );
      return;
    }

    const phone = normalizeLeadPhone(message.contact?.phone_number ?? text);
    if (!phone) {
      await send('Raqam noto‘g‘ri. Masalan: 90 123 45 67', { askContact: CONTACT_BUTTON });
      return;
    }
    await this.redis.client.del(key);
    const username = message.from?.username?.slice(0, 64) ?? null;
    const lead = await this.prisma.controlLead.create({
      data: { chatId: BigInt(chatId), username, name: state.name ?? '—', phone },
    });
    await this.telegram
      .send(
        this.leadText(
          { number: lead.number.toString(), name: lead.name, phone, username },
          'yangi',
        ),
        { buttons: this.leadButtons(lead.id) },
      )
      .catch(() => undefined);

    const earlier = await this.trialOf({ phone });
    if (earlier) {
      await send(this.trialAlready(earlier), { removeKeyboard: true });
      return;
    }
    if (await this.issueTrial(lead, send, true)) return;
    await send(
      `✅ Arizangiz qabul qilindi! Tez orada siz bilan bog‘lanamiz.\nSavol bo‘lsa: ${CONTACT_PHONE}`,
      { removeKeyboard: true },
    );
  }

  /**
   * Bu chat yoki telefon oldin sinov hisobini olganmi (har kimga bitta). Demo sayt ulanmagan bo'lsa,
   * `control_trials`ga umuman murojaat yo'q: migratsiyadan oldin chiqqan kod ham eski oqimda ishlaydi.
   */
  private async trialOf(who: { chatId?: string; phone?: string }) {
    if (!this.config.DEMO_SITE_ID) return null;
    return this.prisma.controlTrial.findFirst({
      where: {
        OR: [
          ...(who.chatId ? [{ chatId: BigInt(who.chatId) }] : []),
          ...(who.phone ? [{ phone: who.phone }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private trialAlready(trial: { login: string; expiresAt: Date }): string {
    const open = trial.expiresAt.getTime() > this.clock.now().getTime();
    return open
      ? `Sizga sinov hisobi berilgan: login ${trial.login}. Parol birinchi xabarda yuborilgan.\n` +
          `Yo‘qotgan bo‘lsangiz, bog‘laning: ${CONTACT_PHONE}`
      : `Sinov muddatingiz tugagan (login ${trial.login}). Davom etish uchun bog‘laning: ${CONTACT_PHONE}`;
  }

  /**
   * Umumiy demo saytda shu odamga alohida ADMIN hisob ochadi va Telegram'ga login, parol, manzilni yuboradi.
   * Demo sayt sozlanmagan yoki javob bermasa — `false` (oddiy ariza oqimi davom etadi, egasiga xabar boradi).
   */
  private async issueTrial(
    lead: { id: string; number: bigint; name: string; phone: string; chatId: bigint },
    send: (body: string, options?: { removeKeyboard?: boolean }) => Promise<unknown>,
    removeKeyboard = false,
  ): Promise<boolean> {
    const siteId = this.config.DEMO_SITE_ID;
    if (!siteId) return false;
    const site = await this.prisma.controlSite.findUnique({ where: { id: siteId } });
    if (!site) return false;
    // Bepul serverdagi demo sayt uxlab yotgan bo'lishi mumkin: avval uyg'otiladi, keyin hisob ochiladi
    // (hisob so'rovi qayta yuborilmaydi — ikki marta ochilib qolmasin).
    const waking = this.sites.wake(site);
    const slow = await Promise.race([
      waking.then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), WAKE_NOTICE_MS).unref()),
    ]);
    if (slow) await send('⏳ Sinov saytingiz tayyorlanmoqda, 1–2 daqiqa kuting…');
    let account;
    try {
      if (!(await waking)) throw new Error('demo sayt 4 daqiqada uyg‘onmadi');
      account = await this.sites.createDemoAccount(site, {
        ref: Number(lead.number),
        name: lead.name,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'noma’lum xato';
      await this.say(
        `⚠️ Ariza #${lead.number}: demo saytda hisob ochilmadi (${reason}). ` +
          'Mijoz /start bossa, qayta urinib ko‘riladi.',
      );
      return false;
    }
    await this.prisma.controlTrial.create({
      data: {
        leadId: lead.id,
        chatId: lead.chatId,
        phone: lead.phone,
        siteId,
        login: account.login,
        expiresAt: new Date(account.expiresAt),
      },
    });
    await send(
      '✅ Sinov sayti tayyor!\n\n' +
        `Sayt: ${site.siteUrl}\nLogin: ${account.login}\nParol: ${account.password}\n\n` +
        `Muddat: ${DEMO_TRIAL_DAYS} kun, jami ${DEMO_TRIAL_MINUTES} daqiqa ishlatish mumkin. ` +
        'Bu hamma uchun umumiy test sayt: foydalanuvchi qo‘shib va bloklab bo‘lmaydi, qolgan hamma narsa ochiq.\n' +
        `Savol bo‘lsa: ${CONTACT_PHONE}`,
      removeKeyboard ? { removeKeyboard: true } : {},
    );
    await this.say(`🎁 Ariza #${lead.number}: sinov hisobi berildi (${account.login}).`);
    return true;
  }

  private recentLead(chatId: string) {
    return this.prisma.controlLead.findFirst({
      where: {
        chatId: BigInt(chatId),
        createdAt: { gte: new Date(this.clock.now().getTime() - LEAD_REPEAT_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async say(text: string): Promise<void> {
    await this.telegram.send(text).catch(() => undefined);
  }
}
