// `.env` yuklovchi BIRINCHI import bo'lishi shart (qarang: config/load-env-file.ts).
import './config/load-env-file.js';
import 'reflect-metadata';
import { configureZodUzbek } from '@divine/shared';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap/configure-app.js';
import { APP_CONFIG } from './config/config.module.js';
import type { AppConfig } from './config/env.schema.js';

async function bootstrap(): Promise<void> {
  configureZodUzbek();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get<AppConfig>(APP_CONFIG);
  configureApp(app, config);

  await app.listen(config.API_PORT, config.API_HOST);
  app.get(Logger).log(`Divine.uz API ishga tushdi: http://${config.API_HOST}:${config.API_PORT}`);
}

bootstrap().catch((error: unknown) => {
  // Logger hali tayyor bo'lmasligi mumkin (masalan, konfiguratsiya xatosi) — stderr'ga yoziladi.
  // InvalidConfigError xabarida secret qiymatlar bo'lmaydi, faqat kalit nomlari.
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
