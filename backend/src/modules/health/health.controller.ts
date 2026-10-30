import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HealthResponse } from '@divine/shared';
import type { Response } from 'express';
import { Public } from '../../common/auth/auth.decorators.js';
import { SkipAllThrottles } from '../../common/throttling/app-throttler.guard.js';
import { HealthService } from './health.service.js';

/**
 * Controller faqat HTTP bilan ishlaydi: so'rovni qabul qiladi, service'ni chaqiradi, status kodini tanlaydi.
 * Public endpoint (SECURITY §1) — hech qanday maxfiy ma'lumot qaytarmaydi. Rate limit qo'llanmaydi:
 * orkestrator va monitoring probe'lari tez-tez so'raydi (SECURITY §7).
 */
@ApiTags('Health')
@Public()
@SkipAllThrottles()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Tizim holati (PostgreSQL, Redis)' })
  @ApiResponse({ status: 200, description: 'Barcha tizimlar ishlayapti' })
  @ApiResponse({ status: 503, description: 'Kamida bitta tizim ishlamayapti' })
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const result = await this.healthService.check();
    res.status(result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    res.setHeader('Cache-Control', 'no-store');
    return result;
  }
}
