import { Global, Inject, Module } from '@nestjs/common';
import { parseConfig } from './env.schema.js';

/** DI token: tiplangan `AppConfig` obyekti. */
export const APP_CONFIG = Symbol('APP_CONFIG');

/** `constructor(@InjectConfig() private readonly config: AppConfig)` */
export const InjectConfig = () => Inject(APP_CONFIG);

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => parseConfig() }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
