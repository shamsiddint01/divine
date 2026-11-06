import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { REPORT_MAX_DAYS, VALIDATION_MESSAGES_UZ } from '@divine/shared';
import { t } from '@/i18n/uz';
import { db } from '@/mocks/db';
import { formatDocNumber } from '@/mocks/inventory';
import { tashkentDate } from '@/mocks/lib/time';
import { sumMoney } from '@/shared/lib/decimal';
import { formatMoney, todayInTashkent } from '@/shared/lib/format';
import { PAGE, renderApp } from '@/test/render-app';

const tile = (title: string) => screen.findByRole('group', { name: title }, PAGE);
/** Testing Library DOM matnidagi NBSP'ni probelga aylantiradi — kutilgan qiymat ham shunday. */
const norm = (text: string) => text.replace(/\s+/g, ' ');

describe('Hisobotlar sahifasi (Phase 12, D-21)', () => {
  it('sana tanlanmasa — joriy oy (1-sanadan bugungacha); yig‘ma shu davr sotuvlariga teng', async () => {
    renderApp('/reports');
    const today = todayInTashkent();
    const from = `${today.slice(0, 8)}01`;
    const revenue = sumMoney(
      db()
        .sales.filter((x) => tashkentDate(x.soldAt) >= from && tashkentDate(x.soldAt) <= today)
        .map((x) => x.totalAmount),
    );
    const revenueTile = await tile(t.reports.kpi.revenue);
    expect(
      await within(revenueTile).findByText(norm(formatMoney(revenue)), {}, PAGE),
    ).toBeInTheDocument();
  });

  it('366 kundan uzun oraliq — server sababi ko‘rsatiladi', async () => {
    renderApp('/reports?dateFrom=2025-01-01&dateTo=2026-10-06');
    expect(
      await screen.findByText(VALIDATION_MESSAGES_UZ.reportRangeTooLong(REPORT_MAX_DAYS), {}, PAGE),
    ).toBeInTheDocument();
  });

  it('moliyaviy xulosa: ombor tanlansa xarajat va sof foyda "—" va izoh bilan', async () => {
    const { state, unmount } = renderApp(
      '/reports?report=finance&dateFrom=2026-10-01&dateTo=2026-10-06',
    );
    expect(await tile(t.reports.finance.items.netProfit)).toBeInTheDocument();
    expect(screen.queryByText(t.reports.finance.notByWarehouse)).toBeNull();
    const warehouseId = state.warehouses[0]!.id;
    unmount();
    renderApp(
      `/reports?report=finance&dateFrom=2026-10-01&dateTo=2026-10-06&warehouseId=${warehouseId}`,
    );
    expect(await screen.findByText(t.reports.finance.notByWarehouse, {}, PAGE)).toBeInTheDocument();
    const expenses = await tile(t.reports.finance.items.expenses);
    expect(within(expenses).getByText(t.common.notSet)).toBeInTheDocument();
  });

  it('kirim hisobotida qator bosilsa — hujjatga qo‘shilgan mahsulotlar ochiladi', async () => {
    const today = todayInTashkent();
    const { state } = renderApp(`/reports?report=incoming&dateFrom=2026-01-01&dateTo=${today}`);
    const doc = state.incoming.find((d) => d.items.length > 0 && d.date >= '2026-01-01');
    if (!doc) throw new Error('kirim hujjati topilmadi');
    const number = formatDocNumber('K', doc.number);

    await userEvent.setup().click(await screen.findByText(number, {}, PAGE));

    const sheet = await screen.findByRole('dialog', {}, PAGE);
    expect(await within(sheet).findByText(t.reports.incomingDetail.items, {}, PAGE)).toBeVisible();
    for (const item of doc.items) {
      const name =
        item.productName ?? state.products.find((p) => p.id === item.productId)?.name ?? '';
      expect(within(sheet).getByText(name)).toBeInTheDocument();
    }
  });
});
