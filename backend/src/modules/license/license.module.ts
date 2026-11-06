import { Module } from '@nestjs/common';
import { LicenseService } from './license.service.js';

/** Alohida modul: AuthModule ham, SiteModule ham ishlatadi. */
@Module({ providers: [LicenseService], exports: [LicenseService] })
export class LicenseModule {}
