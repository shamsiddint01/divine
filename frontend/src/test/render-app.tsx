import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { createQueryClient } from '@/app/query-client';
import { routes } from '@/app/routes';
import { useAuthStore } from '@/features/session/auth-store';
import { authSession } from '@/shared/lib/auth-session';
import { resetEphemeralDb } from '@/mocks/db';
import { setMockLatency } from '@/mocks';
import { TooltipProvider } from '@/shared/ui/tooltip';

/** Lazy sahifa birinchi marta yuklanishini kutish uchun. */
export const PAGE = { timeout: 15_000 };

/** Test uchun aniq vaqt: Toshkent bo'yicha 06.10.2026 15:30. */
export const TEST_NOW = new Date('2026-10-06T10:30:00.000Z');

/**
 * To'liq ilovani (haqiqiy marshrutlar + mock API) xotiradagi router bilan render qiladi.
 * Har chaqiruvda mock DB toza seed holatiga qaytariladi.
 */
export function renderApp(path: string, options: { loggedOut?: boolean } = {}) {
  setMockLatency(0, 0);
  const state = resetEphemeralDb(TEST_NOW);
  // Mock sessiya: seed'da admin kirgan; `loggedOut` — tizimdan chiqilgan holat (login sahifasi).
  if (options.loggedOut) state.currentUserId = '';
  // Har render — yangi ilova ochilishi kabi: sessiya qayta tiklanadi (mock: seed'dagi admin kirgan).
  useAuthStore.setState({ status: 'checking', reason: null });
  authSession.setToken(null);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { ...utils, router, state };
}
