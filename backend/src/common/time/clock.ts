import { Injectable } from '@nestjs/common';

/**
 * Joriy vaqt manbai. Vaqtga bog'liq qoidalar (lockout muddati, token va sessiya muddatlari) shu orqali
 * hisoblanadi — testlarda boshqariladigan soat bilan almashtiriladi (`overrideProvider(Clock)`).
 */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}

/** Testlar uchun: qo'lda suriladigan soat. */
export class ManualClock extends Clock {
  constructor(private current: Date = new Date()) {
    super();
  }

  override now(): Date {
    return new Date(this.current.getTime());
  }

  set(date: Date): void {
    this.current = new Date(date.getTime());
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
