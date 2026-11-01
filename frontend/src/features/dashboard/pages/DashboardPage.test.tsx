import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { t } from '@/i18n/uz';
import { db } from '@/mocks/db';
import { MOCK_DEMO_PASSWORD } from '@/mocks/handlers/auth.constants';
import { tashkentDate } from '@/mocks/lib/time';
import { sumMoney } from '@/shared/lib/decimal';
import { formatCompactMoney } from '@/shared/lib/format';
import { FAIL_MESSAGE, failRoutes, restoreRoutes } from '@/test/fail-routes';
import { PAGE, renderApp } from '@/test/render-app';

afterEach(restoreRoutes);

describe('Bosh sahifa (Phase 12, OWN-08)', () => {
  it('sotuvchi: faqat o‘z bugungi ko‘rsatkichlari; admin grafik, top va kam qoldiq yo‘q', async () => {
    renderApp('/login', { loggedOut: true });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(t.auth.login, {}, PAGE), 'aziz');
    await user.type(
      screen.getByLabelText(t.auth.password, { selector: 'input' }),
      MOCK_DEMO_PASSWORD,
    );
    await user.click(screen.getByRole('button', { name: t.auth.submit }));

    expect(await screen.findByText(t.dashboard.my.todaySales, {}, PAGE)).toBeInTheDocument();
    const s = db();
    const own = s.sales.filter(
      (x) => x.userId === s.currentUserId && tashkentDate(x.soldAt) === '2026-10-06',
    );
    await waitFor(
      () =>
        expect(
          screen.getAllByText(
            formatCompactMoney(sumMoney(own.map((x) => x.totalAmount))).replace(/\s+/g, ' '),
          ).length,
        ).toBeGreaterThan(0),
      PAGE,
    );
    expect(screen.getByText(t.dashboard.my.warehouses)).toBeInTheDocument();
    expect(screen.queryByText(t.dashboard.chart.title)).toBeNull();
    expect(screen.queryByText(t.dashboard.topProducts)).toBeNull();
    expect(screen.queryByText(t.dashboard.lowStock)).toBeNull();
    // Kam qoldiq bildirishnomasi admin `dashboard/summary`dan — sotuvchida yo'q (so'rov ham yo'q).
    expect(screen.queryByRole('button', { name: t.topbar.notifications })).toBeNull();
  });

  it('admin: kompaniya bo‘yicha KPI, grafik va kam qoldiq', async () => {
    renderApp('/');
    expect(await screen.findByText(t.dashboard.kpi.lowStock, {}, PAGE)).toBeInTheDocument();
    expect(screen.getByText(t.dashboard.topProducts)).toBeInTheDocument();
    expect(screen.queryByText(t.dashboard.my.todaySales)).toBeNull();
    expect(screen.getByRole('button', { name: t.topbar.notifications })).toBeInTheDocument();
  });

  it('admin: panel yuklanmasa xato holati va qayta urinish; kam qoldiq "yetarli" deb ko‘rsatilmaydi', async () => {
    failRoutes([
      '/dashboard/summary',
      '/dashboard/sales-trend',
      '/dashboard/top-products',
      '/sales',
    ]);
    renderApp('/');
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(5), PAGE);
    for (const alert of screen.getAllByRole('alert')) {
      expect(within(alert).getByText(FAIL_MESSAGE)).toBeInTheDocument();
    }
    expect(screen.queryByText(t.dashboard.lowStockEmpty)).toBeNull();
    expect(screen.queryByText(t.dashboard.topProductsEmpty)).toBeNull();
    expect(screen.queryByText(t.dashboard.recentSalesEmpty)).toBeNull();

    restoreRoutes();
    const user = userEvent.setup();
    const topCard = screen.getByText(t.dashboard.topProducts).closest('[data-slot=card]');
    await user.click(within(topCard as HTMLElement).getByRole('button', { name: t.common.retry }));
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(4));
    expect(within(topCard as HTMLElement).getAllByRole('listitem').length).toBeGreaterThan(0);
  });

  it('admin: sotuvlar bo‘lmasa panellarda bo‘sh holat', async () => {
    const { state } = renderApp('/');
    state.sales = [];
    expect(await screen.findByText(t.dashboard.topProductsEmpty, {}, PAGE)).toBeInTheDocument();
    expect(screen.getByText(t.dashboard.recentSalesEmpty)).toBeInTheDocument();
  });
});
