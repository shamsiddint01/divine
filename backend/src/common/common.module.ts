import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { GlobalExceptionFilter } from './filters/global-exception.filter.js';
import { THROTTLERS } from './throttling/app-throttler.guard.js';
import {
  RedisThrottlerStorage,
  RedisThrottlerStorageModule,
} from './throttling/redis-throttler.storage.js';
import { Clock } from './time/clock.js';

/**
 * HTTP foundation: global xato filtri, rate limit sozlamalari (storage — Redis) va `Clock`.
 * Global guard'lar (rate limit → JwtAuth → Permissions) bitta joyda, aniq tartibda — `AuthModule`da.
 */
@Global()
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [RedisThrottlerStorageModule],
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({ throttlers: THROTTLERS, storage }),
    }),
  ],
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }, Clock],
  exports: [Clock],
})
export class CommonModule {}
