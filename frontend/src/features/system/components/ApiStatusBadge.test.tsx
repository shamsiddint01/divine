import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/app/query-client';
import { t } from '@/i18n/uz';
import { HealthBadge } from './ApiStatusBadge';

// http rejimdagi server holati belgisi (/health) — mock rejimni chetlab, fetch orqali.
vi.mock('@/shared/lib/api-mode', () => ({
  apiMode: 'http',
  authMode: 'http',
  isMockMode: () => false,
  transportFor: () => 'http',
}));

function renderWith(health: { status: number; body: unknown } | Error) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    if (health instanceof Error) throw health;
    return {
      ok: health.status < 400,
      status: health.status,
      json: async () => health.body,
    } as Response;
  });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <HealthBadge />
    </QueryClientProvider>,
  );
}

describe('HealthBadge (http rejim)', () => {
  it('server ishlasa — "ishlayapti"', async () => {
    renderWith({ status: 200, body: { status: 'ok' } });
    expect(await screen.findByText(t.system.apiOnline)).toBeInTheDocument();
  });

  it('503 (degraded) — ogohlantirish', async () => {
    renderWith({ status: 503, body: { status: 'degraded' } });
    expect(await screen.findByText(t.system.apiDegraded)).toBeInTheDocument();
  });

  it('tarmoq xatosi — "aloqa yo‘q"', async () => {
    renderWith(new TypeError('Failed to fetch'));
    expect(await screen.findByText(t.system.apiOffline)).toBeInTheDocument();
  });
});
