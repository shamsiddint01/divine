import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  type BackupReportInput,
  backupReportSchema,
  Permission,
  type SiteAccessRequestDto,
  type SiteLicenseDto,
  type SiteLicenseInput,
  siteLicenseSchema,
  type SiteMaintenanceInput,
  siteMaintenanceSchema,
  type SiteStatsDto,
  type SiteStatusDto,
  type SiteViewVerifyInput,
  siteViewVerifySchema,
} from '@divine/shared';
import type { AccessContext } from '../../common/auth/access-context.js';
import {
  Authenticated,
  Ctx,
  Public,
  RequirePermissions,
} from '../../common/auth/auth.decorators.js';
import { ZodBody } from '../../common/validation/zod-validation.pipe.js';
import { LicenseService } from '../license/license.service.js';
import { ControlTokenGuard } from './control-token.guard.js';
import { BackupStatusService } from './backup-status.service.js';
import { SiteAccessService } from './site-access.service.js';
import { SiteStatsService } from './site-stats.service.js';

/** Sayt foydalanuvchilari uchun: to'lov eslatmasi va superadmin so'rovi bildirishnomasi. */
@ApiTags('Site')
@Controller('site')
export class SiteController {
  constructor(
    private readonly license: LicenseService,
    private readonly access: SiteAccessService,
  ) {}

  @Get('license')
  @Authenticated()
  @ApiOperation({ summary: 'To‘lov muddati (eslatma uchun)' })
  getLicense(): Promise<SiteLicenseDto | null> {
    return this.license.current();
  }

  @Get('access-request')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Superadminning faol ko‘rish so‘rovi' })
  getAccessRequest(): Promise<SiteAccessRequestDto | null> {
    return this.access.active();
  }

  @Delete('access-request/:id')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @HttpCode(204)
  @ApiOperation({ summary: 'Ko‘rish so‘rovini rad etish' })
  deny(@Param('id') id: string, @Ctx() ctx: AccessContext): Promise<void> {
    return this.access.deny(id, ctx.userId);
  }
}

/** Superadmin panelidan: kalit bilan (`x-control-token`), foydalanuvchi sessiyasisiz. */
@ApiTags('Site control')
@Public()
@UseGuards(ControlTokenGuard)
@Controller('site-control')
export class SiteControlController {
  constructor(
    private readonly license: LicenseService,
    private readonly access: SiteAccessService,
    private readonly backups: BackupStatusService,
    private readonly siteStats: SiteStatsService,
  ) {}

  @Put('license')
  @HttpCode(204)
  @ApiOperation({ summary: 'Egasi nomi va to‘lov muddatini yozish' })
  setLicense(@ZodBody(siteLicenseSchema) body: SiteLicenseInput) {
    return this.license.set(body);
  }

  @Post('backup-report')
  @HttpCode(204)
  @ApiOperation({ summary: 'Kechki bekap natijasi (GitHub Actions)' })
  backupReport(@ZodBody(backupReportSchema) body: BackupReportInput) {
    return this.backups.report(body);
  }

  /** Diagnostika: so'rov qaysi proxy'lardan o'tganini ko'rish (`TRUST_PROXY` uchun). */
  @Get('request-info')
  @ApiOperation({ summary: 'So‘rov IP zanjiri (diagnostika)' })
  requestInfo(@Req() req: Request) {
    return {
      ip: req.ip ?? null,
      ips: req.ips,
      remoteAddress: req.socket.remoteAddress ?? null,
      forwardedFor: req.headers['x-forwarded-for'] ?? null,
      realIp: req.headers['x-real-ip'] ?? null,
      cfConnectingIp: req.headers['cf-connecting-ip'] ?? null,
      trueClientIp: req.headers['true-client-ip'] ?? null,
    };
  }

  @Get('status')
  @ApiOperation({ summary: 'Sayt holati: oxirgi bekap, versiya, texnik ishlar' })
  async siteStatus(): Promise<SiteStatusDto> {
    return {
      backup: await this.backups.last(),
      version: this.siteStats.version(),
      maintenance: await this.license.maintenance(),
    };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Sayt ishlatilyaptimi: sonlar va foydalanuvchilar faolligi' })
  stats(): Promise<SiteStatsDto> {
    return this.siteStats.stats();
  }

  @Put('maintenance')
  @HttpCode(204)
  @ApiOperation({ summary: 'Texnik ishlar rejimi' })
  setMaintenance(@ZodBody(siteMaintenanceSchema) body: SiteMaintenanceInput) {
    return this.license.setMaintenance(body);
  }

  @Post('sessions/revoke-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Hamma foydalanuvchini tizimdan chiqarish' })
  revokeAllSessions() {
    return this.license.revokeAllSessions();
  }

  @Post('access-requests')
  @ApiOperation({ summary: 'Adminga ko‘rish so‘rovi yuborish' })
  request() {
    return this.access.request();
  }

  @Get('access-requests/:id')
  @ApiOperation({ summary: 'So‘rov holati (admin rad etdimi)' })
  async status(@Param('id') id: string) {
    return { status: await this.access.status(id) };
  }

  @Post('access-requests/:id/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Admin aytgan kodni tekshirish' })
  verify(@Param('id') id: string, @ZodBody(siteViewVerifySchema) body: SiteViewVerifyInput) {
    return this.access.verify(id, body.code);
  }
}
