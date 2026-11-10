import { Module } from '@nestjs/common';
import { DemoRestrictedGuard } from './demo-restricted.guard.js';
import { DemoUsageService } from './demo-usage.service.js';

/** Umumiy demo sayt: sinov hisobi vaqti va cheklovlari. AuthModule, UsersModule va SiteModule ishlatadi. */
@Module({
  providers: [DemoUsageService, DemoRestrictedGuard],
  exports: [DemoUsageService, DemoRestrictedGuard],
})
export class DemoModule {}
