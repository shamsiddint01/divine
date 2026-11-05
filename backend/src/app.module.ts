import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module.js';
import { AppConfigModule } from './config/config.module.js';
import { LoggerModule } from './infrastructure/logger/logger.module.js';
import { PrismaModule } from './infrastructure/prisma/prisma.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { AuditModule } from './modules/audit/audit.service.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { CreditsModule } from './modules/credits/credits.module.js';
import { ExpensesModule } from './modules/expenses/expenses.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { IncomingModule } from './modules/incoming/incoming.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { ProductGroupsModule } from './modules/product-groups/product-groups.module.js';
import { ProductsModule } from './modules/products/products.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { SalesModule } from './modules/sales/sales.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { WarehousesModule } from './modules/warehouses/warehouses.module.js';

/**
 * Ildiz modul. Biznes modullari (users, products, ...) tegishli phase'larda
 * `src/modules/<modul>` ichida yaratilib, shu yerga qo'shiladi.
 */
@Module({
  imports: [
    AppConfigModule,
    LoggerModule,
    PrismaModule,
    RedisModule,
    CommonModule,
    AuditModule,
    AuthModule,
    UsersModule,
    ProductGroupsModule,
    ProductsModule,
    WarehousesModule,
    InventoryModule,
    IncomingModule,
    CustomersModule,
    SalesModule,
    ExpensesModule,
    CreditsModule,
    ReportsModule,
    DashboardModule,
    SettingsModule,
    HealthModule,
  ],
})
export class AppModule {}
