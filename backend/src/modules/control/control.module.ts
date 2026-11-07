import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import {
  ControlAuthController,
  ControlCronController,
  ControlSitesController,
} from './control.controller.js';
import { ControlTwoFactor } from './control-two-factor.js';
import { TelegramService } from './telegram.service.js';
import { ControlTokenGuard } from '../site/control-token.guard.js';
import { ControlEnabledGuard, ControlSessionGuard } from './control.guard.js';
import { ControlService } from './control.service.js';
import { SiteClient } from './site-client.js';

/** Superadmin paneli API'si (`CONTROL_PANEL_ENABLED`). */
@Module({
  imports: [AuthModule],
  controllers: [ControlAuthController, ControlCronController, ControlSitesController],
  providers: [
    ControlService,
    SiteClient,
    TelegramService,
    ControlTwoFactor,
    ControlEnabledGuard,
    ControlSessionGuard,
    ControlTokenGuard,
  ],
})
export class ControlModule {}
