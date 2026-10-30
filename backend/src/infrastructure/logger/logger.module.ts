import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { buildLoggerOptions } from './logger.options.js';

/**
 * Log yozuvlari boradigan joy. Standart — stdout (`null`); testlar `overrideProvider(LOG_STREAM)` bilan
 * log'larni xotirada ushlab, requestId bog'lanishi va redaction'ni tekshiradi.
 */
export const LOG_STREAM = Symbol('LOG_STREAM');

@Module({
  providers: [{ provide: LOG_STREAM, useValue: null }],
  exports: [LOG_STREAM],
})
class LogDestinationModule {}

/** Structured JSON logging (pino) + requestId + sensitive maydonlarni redact qilish. */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [LogDestinationModule],
      inject: [APP_CONFIG, LOG_STREAM],
      useFactory: (config: AppConfig, stream: DestinationStream | null) =>
        buildLoggerOptions(config, stream ?? undefined),
    }),
  ],
})
export class LoggerModule {}
