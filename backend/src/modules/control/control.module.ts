import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ControlAuthController, ControlSitesController } from './control.controller.js';
import { ControlEnabledGuard, ControlSessionGuard } from './control.guard.js';
import { ControlService } from './control.service.js';
import { SiteClient } from './site-client.js';

/** Superadmin paneli API'si (`CONTROL_PANEL_ENABLED`). */
@Module({
  imports: [AuthModule],
  controllers: [ControlAuthController, ControlSitesController],
  providers: [ControlService, SiteClient, ControlEnabledGuard, ControlSessionGuard],
})
export class ControlModule {}
