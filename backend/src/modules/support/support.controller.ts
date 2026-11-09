import { timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AnnouncementInput,
  announcementSchema,
  ErrorCode,
  type SupportErrorInput,
  supportErrorSchema,
  type SupportFeedbackInput,
  supportFeedbackSchema,
  type SupportReplyInput,
  supportReplySchema,
  type SupportStatusInput,
  supportStatusSchema,
  type SupportTicketCreateInput,
  supportTicketCreateSchema,
} from '@divine/shared';
import type { Request } from 'express';
import { z } from 'zod';
import type { AccessContext } from '../../common/auth/access-context.js';
import { Authenticated, Ctx, Public } from '../../common/auth/auth.decorators.js';
import { AppError } from '../../common/errors/app-error.js';
import { ZodBody } from '../../common/validation/zod-validation.pipe.js';
import { InjectConfig } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { ControlTokenGuard } from '../site/control-token.guard.js';
import { SupportService, telegramWebhookSecret } from './support.service.js';

const userAgentOf = (req: Request) => {
  const value = req.headers['user-agent'];
  return typeof value === 'string' ? value : null;
};

/** Saytdagi "Murojaat" bo'limi: har qanday kirgan foydalanuvchi. */
@ApiTags('Support')
@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post('tickets')
  @Authenticated()
  @ApiOperation({ summary: 'Murojaat yuborish' })
  create(
    @Ctx() ctx: AccessContext,
    @ZodBody(supportTicketCreateSchema) body: SupportTicketCreateInput,
    @Req() req: Request,
  ) {
    return this.support.create(ctx, body, userAgentOf(req));
  }

  @Get('tickets')
  @Authenticated()
  @ApiOperation({ summary: 'Mening murojaatlarim' })
  mine(@Ctx() ctx: AccessContext) {
    return this.support.mine(ctx);
  }

  @Post('tickets/:id/replies')
  @Authenticated()
  @ApiOperation({ summary: 'Murojaatga javob yozish' })
  reply(
    @Ctx() ctx: AccessContext,
    @Param('id') id: string,
    @ZodBody(supportReplySchema) body: SupportReplyInput,
  ) {
    return this.support.replyAsUser(ctx, id, body.body);
  }

  @Post('errors')
  @Authenticated()
  @HttpCode(204)
  @ApiOperation({ summary: 'Sahifa xatosi (avtomatik)' })
  error(
    @Ctx() ctx: AccessContext,
    @ZodBody(supportErrorSchema) body: SupportErrorInput,
    @Req() req: Request,
  ) {
    return this.support.reportError(ctx, body, userAgentOf(req));
  }

  @Post('feedback')
  @Authenticated()
  @HttpCode(204)
  @ApiOperation({ summary: 'Savol-javob bahosi' })
  feedback(@ZodBody(supportFeedbackSchema) body: SupportFeedbackInput) {
    return this.support.feedback(body.topic, body.helpful);
  }

  @Get('announcement')
  @Authenticated()
  @ApiOperation({ summary: 'Saytdagi e’lon (texnik ishlar)' })
  async announcement() {
    return this.support.announcement();
  }
}

/** Panel uchun: saytning kaliti bilan. */
@ApiTags('Site control')
@Public()
@UseGuards(ControlTokenGuard)
@Controller('site-control/support')
export class SupportControlController {
  constructor(private readonly support: SupportService) {}

  @Get('tickets')
  @ApiOperation({ summary: 'Murojaatlar' })
  list() {
    return this.support.list();
  }

  @Post('tickets/:id/replies')
  @ApiOperation({ summary: 'Murojaatga javob' })
  reply(@Param('id') id: string, @ZodBody(supportReplySchema) body: SupportReplyInput) {
    return this.support.replyAsSupport(id, body.body);
  }

  @Patch('tickets/:id')
  @ApiOperation({ summary: 'Murojaat holati' })
  status(@Param('id') id: string, @ZodBody(supportStatusSchema) body: SupportStatusInput) {
    return this.support.setStatus(id, body.status);
  }

  @Get('feedback')
  @ApiOperation({ summary: 'Savol-javob baholari' })
  feedback() {
    return this.support.feedbackSummary();
  }

  @Put('announcement')
  @HttpCode(204)
  @ApiOperation({ summary: 'E’lon qo‘yish' })
  setAnnouncement(@ZodBody(announcementSchema) body: AnnouncementInput) {
    return this.support.setAnnouncement(body);
  }

  @Delete('announcement')
  @HttpCode(204)
  @ApiOperation({ summary: 'E’lonni olib tashlash' })
  clearAnnouncement() {
    return this.support.setAnnouncement(null);
  }

  @Post('telegram-webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Telegram javoblari uchun webhook’ni ulash' })
  registerWebhook(@ZodBody(z.strictObject({ url: z.url() })) body: { url: string }) {
    return this.support.registerWebhook(body.url);
  }
}

/** Telegram shu yerga yuboradi: `X-Telegram-Bot-Api-Secret-Token` sir bilan tekshiriladi. */
@ApiTags('Support')
@Public()
@Controller('support/telegram')
export class TelegramWebhookController {
  private readonly secret: Buffer;

  constructor(
    private readonly support: SupportService,
    @InjectConfig() config: AppConfig,
  ) {
    this.secret = Buffer.from(telegramWebhookSecret(config));
  }

  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Telegram yangilanishi (egasining javobi)' })
  async webhook(
    @Headers('x-telegram-bot-api-secret-token') header: string | undefined,
    @Body() update: unknown,
  ): Promise<{ ok: true }> {
    const given = Buffer.from(header ?? '');
    if (given.length !== this.secret.length || !timingSafeEqual(given, this.secret)) {
      throw new AppError(ErrorCode.FORBIDDEN);
    }
    await this.support.telegramUpdate(update);
    return { ok: true };
  }
}
