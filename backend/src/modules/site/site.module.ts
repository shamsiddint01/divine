import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LicenseModule } from '../license/license.module.js';
import { ControlTokenGuard } from './control-token.guard.js';
import { BackupStatusService } from './backup-status.service.js';
import { SiteAccessService } from './site-access.service.js';
import { SiteStatsService } from './site-stats.service.js';
import { SiteControlController, SiteController } from './site.controller.js';

/** Saytning superadmin bilan aloqasi: to'lov muddati, eslatma va ko'rish so'rovi. */
@Module({
  imports: [AuthModule, LicenseModule],
  controllers: [SiteController, SiteControlController],
  providers: [SiteAccessService, BackupStatusService, SiteStatsService, ControlTokenGuard],
})
export class SiteModule {}
