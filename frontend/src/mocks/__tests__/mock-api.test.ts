import { beforeEach, describe, expect, it } from 'vitest';
import { addQty, compareQty, subMoney, sumMoney, sumQty } from '@/shared/lib/decimal';
import type {
  AuditLogPage,
  DashboardSummaryDto,
  ExpenseDto,
  ExpensesListResponse,
  FinanceSummaryDto,
  MyDashboardSummaryDto,
  Paginated,
  ProductDto,
  ReportResponse,
  SaleDto,
  SalesTrendPoint,
  SettingsDto,
  TopProductDto,
  UserCreatedResponse,
  WarehouseDto,
} from '@/shared/types/api';
import { resetEphemeralDb } from '../db';
import { mockRequest, setMockLatency } from '../index';
import { tashkentDate } from '../lib/time';
import { type MockState, stockKey } from '../state';

const NOW = new Date('2026-10-06T10:30:00.000Z'); // Toshkent: 15:30
let state: MockState;

beforeEach(() => {
  setMockLatency(0, 0);
  state = resetEphemeralDb(NOW);
});

const get = <T>(path: string, query?: Record<string, string>) => mockRequest<T>(path, { query });
const post = <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
  mockRequest<T>(path, { method: 'POST', body, headers });

describe('seed ma’lumotlari (ledger izchilligi)', () => {
  it('har bir (ombor, mahsulot) qoldig‘i ledger yig‘indisiga teng va manfiy emas', () => {
    const ledger = new Map<string, string>();
    for (const m of state.movements) {
      const key = `${m.warehouseId}|${m.productId}`;
      ledger.set(key, addQty(ledger.get(key) ?? '0', m.quantity));
    }
    for (const [key, qty] of Object.entries(state.stock)) {
      expect(compareQty(qty, ledger.get(key) ?? '0'), key).toBe(0);
      expect(compareQty(qty, '0'), key).toBeGreaterThanOrEqual(0);
    }
  });

  it('bugungi kunda sotuvlar va kam qolgan mahsulotlar bor (dashboard bo‘sh emas)', async () => {
    const summary = await get<DashboardSummaryDto>('/dashboard/summary');
    expect(summary.today.salesCount).toBeGreaterThan(0);
    expect(summary.lowStock.count).toBeGreaterThan(0);
    expect(summary.users.active).toBeGreaterThan(0);
  });
});

describe('sotuv (POST /sales)', () => {
  async function stockedProduct() {
    const warehouses = await get<Paginated<WarehouseDto>>('/warehouses');
    const w = warehouses.data[0] as WarehouseDto;
    const products = await get<Paginated<ProductDto>>('/products', {
      warehouseId: w.id,
      pageSize: '100',
      status: 'ACTIVE',
    });
    const p = products.data.find(
      (x) => x.unit === 'DONA' && compareQty(x.stock, '2') >= 0,
    ) as ProductDto;
    return { w, p };
  }

  it('qoldiqni kamaytiradi, narxni serverda oladi va harakat yozadi', async () => {
    const { w, p } = await stockedProduct();
    const sale = await post<SaleDto>(
      '/sales',
      {
        warehouseId: w.id,
        customer: { name: 'Test Mijoz' },
        items: [{ productId: p.id, quantity: '2' }],
      },
      { 'Idempotency-Key': crypto.randomUUID() },
    );
    expect(sale.items?.[0]?.unitPrice).toBe(p.salePrice);
    const after = await get<ProductDto>(`/products/${p.id}`);
    const before = p.warehouses.find((x) => x.warehouseId === w.id)?.quantity ?? '0';
    expect(after.warehouses.find((x) => x.warehouseId === w.id)?.quantity).toBe(
      addQty(before, '-2'),
    );
    expect(state.movements.at(-1)?.referenceId).toBe(sale.id);
  });

  it('qoldiqdan ko‘p sotishni rad etadi va hech narsani o‘zgartirmaydi (BR-07)', async () => {
    const { w, p } = await stockedProduct();
    const salesBefore = state.sales.length;
    const movementsBefore = state.movements.length;
    const error = await post(
      '/sales',
      {
        warehouseId: w.id,
        customer: { name: 'Test' },
        items: [{ productId: p.id, quantity: '999999' }],
      },
      { 'Idempotency-Key': crypto.randomUUID() },
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 409, code: 'INSUFFICIENT_STOCK' });
    expect(state.sales.length).toBe(salesBefore);
    expect(state.movements.length).toBe(movementsBefore);
  });

  it('ismsiz sotuv — bitta umumiy "Noma’lum mijoz" (2026-11-03); noto‘g‘ri ism — 400', async () => {
    const { w, p } = await stockedProduct();
    const sell = (customer: Record<string, unknown>) =>
      post<SaleDto>(
        '/sales',
        { warehouseId: w.id, customer, items: [{ productId: p.id, quantity: '1' }] },
        { 'Idempotency-Key': crypto.randomUUID() },
      );
    const a = await sell({ name: '   ' });
    const b = await sell({});
    expect(a.customer.name).toBe(WALK_IN_CUSTOMER_NAME);
    expect(b.customer.id).toBe(a.customer.id);
    const error = await sell({ name: 'A'.repeat(151) }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });

  it('bir xil Idempotency-Key bilan takroriy so‘rov yangi sotuv yaratmaydi', async () => {
    const { w, p } = await stockedProduct();
    const body = {
      warehouseId: w.id,
      customer: { name: 'Takror' },
      items: [{ productId: p.id, quantity: '1' }],
    };
    // Kalit — UUID (backend shartnomasi, `sales.idempotency_key UUID`).
    const key = crypto.randomUUID();
    const first = await post<SaleDto>('/sales', body, { 'Idempotency-Key': key });
    const second = await post<SaleDto>('/sales', body, { 'Idempotency-Key': key });
    expect(second.id).toBe(first.id);
    // Xuddi shu kalit boshqa payload bilan — 409 (backend bilan bir xil).
    const reused = await post(
      '/sales',
      { ...body, items: [{ productId: p.id, quantity: '2' }] },
      {
        'Idempotency-Key': key,
      },
    ).catch((e: unknown) => e);
    expect(reused).toMatchObject({ status: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
  });
});

describe('qoldiq qo‘shish (sobiq kirim)', () => {
  async function activeWarehouse() {
    const warehouses = await get<Paginated<WarehouseDto>>('/warehouses');
    return warehouses.data.find((w) => w.status === 'ACTIVE') as WarehouseDto;
  }

  it('yangi mahsulot + boshlang‘ich qoldiq: qoldiq, tasdiqlangan kirim hujjati va audit bir vaqtda', async () => {
    const w = await activeWarehouse();
    const groupId = state.groups.find((g) => g.isActive)!.id;
    const created = await post<ProductDto>('/products', {
      name: 'Qoldiqli yangi mahsulot',
      groupId,
      costPrice: '700',
      salePrice: '900',
      unit: 'DONA',
      allowDecimal: false,
      initialStock: { warehouseId: w.id, quantity: '12', date: '2026-10-06' },
    });
    expect(created.stock).toBe('12.000');
    const doc = state.incoming.find((d) => d.items.some((i) => i.productId === created.id));
    expect(doc).toMatchObject({ status: 'CONFIRMED', warehouseId: w.id });
    expect(doc?.items[0]).toMatchObject({ quantity: '12', costPrice: '700' });
  });

  it('atomiklik: kasr miqdor (DONA) → 422 va mahsulot yaratilmaydi', async () => {
    const w = await activeWarehouse();
    const before = state.products.length;
    await expect(
      post('/products', {
        name: 'Kasr qoldiqli',
        groupId: state.groups.find((g) => g.isActive)!.id,
        costPrice: '1',
        salePrice: '2',
        unit: 'DONA',
        allowDecimal: false,
        initialStock: { warehouseId: w.id, quantity: '1.5', date: '2026-10-06' },
      }),
    ).rejects.toMatchObject({ status: 422, code: 'INVALID_QUANTITY' });
    expect(state.products).toHaveLength(before);
  });

  it('mavjud mahsulotga qoldiq qo‘shish: ombor qoldig‘i oshadi, kartadagi kelgan narxi o‘zgarmaydi (D-16)', async () => {
    const w = await activeWarehouse();
    const product = state.products.find((p) => p.status === 'ACTIVE' && !p.allowDecimal)!;
    const key = stockKey(w.id, product.id);
    const before = state.stock[key] ?? '0';
    const res = await post<ProductDto>(`/products/${product.id}/stock`, {
      warehouseId: w.id,
      quantity: '5',
      costPrice: '1.00',
      date: '2026-10-06',
    });
    expect(res.id).toBe(product.id);
    expect(state.stock[key]).toBe(addQty(before, '5'));
    expect(state.products.find((p) => p.id === product.id)!.costPrice).toBe(product.costPrice);
    await expect(
      post(`/products/${product.id}/stock`, {
        warehouseId: w.id,
        quantity: '1.5',
        costPrice: '1',
        date: '2026-10-06',
      }),
    ).rejects.toMatchObject({ status: 422, code: 'INVALID_QUANTITY' });
  });
});

describe('userlar', () => {
  it('server 6 xonali parol yaratadi; noto‘g‘ri va band login rad etiladi', async () => {
    const created = await post<UserCreatedResponse>('/users', {
      login: 'yangi01',
      role: 'USER',
      warehouseIds: [],
    });
    expect(created.generatedPassword).toMatch(/^\d{6}$/);
    await expect(
      post('/users', { login: 'ali 1', role: 'USER', warehouseIds: [] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      post('/users', { login: 'ADMIN', role: 'USER', warehouseIds: [] }),
    ).rejects.toMatchObject({ code: 'LOGIN_TAKEN' });
  });
});

describe('filtrlar birgalikda ishlaydi', () => {
  it('sana + mahsulot + user filtri faqat mos sotuvlarni qaytaradi', async () => {
    const sale = state.sales.at(-1);
    if (!sale) throw new Error('sotuv yo‘q');
    const productId = sale.items[0]?.productId ?? '';
    const res = await get<Paginated<SaleDto>>('/sales', {
      dateFrom: '2026-09-01',
      dateTo: '2026-10-06',
      productId,
      userId: sale.userId,
      pageSize: '100',
    });
    expect(res.data.length).toBeGreaterThan(0);
    for (const s of res.data) {
      const row = state.sales.find((x) => x.id === s.id);
      expect(row?.userId).toBe(sale.userId);
      expect(row?.items.some((i) => i.productId === productId)).toBe(true);
    }
  });
});

describe('xarajatlar (D-11: holatsiz; D-19: kategoriya majburiy, kelajak sana yo‘q)', () => {
  const patch = <T>(path: string, body: unknown) => mockRequest<T>(path, { method: 'PATCH', body });
  const activeCategory = () => state.expenseCategories.find((c) => c.isActive)!.id;

  it('sana + summa + kategoriya + izoh bilan yaratiladi; ro‘yxat va "Jami"da ko‘rinadi', async () => {
    const categoryId = activeCategory();
    const before = await get<ExpensesListResponse>('/expenses');
    const created = await post<ExpenseDto>('/expenses', {
      date: '2026-10-06',
      amount: '150000',
      categoryId,
      note: 'Tushlik, 4 kishi',
    });
    expect(created).toMatchObject({ amount: '150000.00', category: { id: categoryId } });
    expect(created).not.toHaveProperty('status');
    const after = await get<ExpensesListResponse>('/expenses');
    expect(after.summary.count).toBe(before.summary.count + 1);
    expect(
      compareQty(addQty(after.summary.totalAmount, '-150000'), before.summary.totalAmount),
    ).toBe(0);
    expect(after.summary).not.toHaveProperty('paidAmount');
  });

  it('kategoriyasiz yoki holat bilan → 400; kelajak sana → 400; noma’lum → 404; nofaol → 422', async () => {
    const categoryId = activeCategory();
    const body = { date: '2026-10-06', amount: '1000.00', categoryId };
    const fails = async (payload: unknown) => post('/expenses', payload).catch((e: unknown) => e);
    expect(await fails({ date: '2026-10-06', amount: '1000.00' })).toMatchObject({ status: 400 });
    expect(await fails({ ...body, status: 'PAID' })).toMatchObject({ status: 400 });
    expect(await fails({ ...body, date: '2026-10-07' })).toMatchObject({
      status: 400,
      details: [{ field: 'date' }],
    });
    expect(
      await fails({ ...body, categoryId: '01990000-0000-7000-8000-000000000000' }),
    ).toMatchObject({ status: 404 });
    state.expenseCategories.find((c) => c.id === categoryId)!.isActive = false;
    expect(await fails(body)).toMatchObject({ status: 422, code: 'EXPENSE_CATEGORY_INACTIVE' });
  });

  it('qisman PATCH; soft delete ro‘yxat va yig‘madan chiqaradi; ishlatilgan kategoriya o‘chirilmaydi', async () => {
    const categoryId = activeCategory();
    const e = await post<ExpenseDto>('/expenses', {
      date: '2026-10-05',
      amount: '500',
      categoryId,
      note: 'Izoh',
    });
    const updated = await patch<ExpenseDto>(`/expenses/${e.id}`, { amount: '750.5' });
    expect(updated).toMatchObject({
      date: '2026-10-05',
      amount: '750.50',
      note: 'Izoh',
      category: { id: categoryId },
    });
    expect(await patch<ExpenseDto>(`/expenses/${e.id}`, { note: null })).toMatchObject({
      note: null,
      amount: '750.50',
    });
    const before = await get<ExpensesListResponse>('/expenses', { categoryId });
    await mockRequest(`/expenses/${e.id}`, { method: 'DELETE' });
    const after = await get<ExpensesListResponse>('/expenses', { categoryId });
    expect(after.summary.count).toBe(before.summary.count - 1);
    expect(after.data.some((x) => x.id === e.id)).toBe(false);
    await expect(mockRequest(`/expenses/${e.id}`)).rejects.toMatchObject({ status: 404 });
    await expect(
      mockRequest(`/expense-categories/${categoryId}`, { method: 'DELETE' }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('hisobotlar, dashboard va sozlamalar (Phase 12 — backend bilan bir xil shartnoma)', () => {
  const range = { dateFrom: '2026-10-01', dateTo: '2026-10-06' };
  const fails = (path: string, query?: Record<string, string>) =>
    get(path, query).catch((e: unknown) => e);
  const loginAs = (login: string) => {
    state.currentUserId = state.users.find((u) => u.login === login)!.id;
  };
  const salesInRange = () =>
    state.sales.filter((x) => {
      const day = tashkentDate(x.soldAt);
      return day >= range.dateFrom && day <= range.dateTo;
    });
  const summaryOf = (report: ReportResponse) =>
    Object.fromEntries(report.summary.map((s) => [s.labelKey, s.value]));

  it('sotuvchi: hisobotlar, admin dashboard va sozlamalar → 403; o‘z ko‘rsatkichlari — faqat o‘ziniki', async () => {
    loginAs('aziz');
    for (const path of ['/reports/sales', '/reports/finance-summary', '/dashboard/summary']) {
      expect(await fails(path, range)).toMatchObject({ status: 403 });
    }
    expect(await fails('/dashboard/sales-trend')).toMatchObject({ status: 403 });
    expect(await fails('/settings')).toMatchObject({ status: 403 });
    const my = await get<MyDashboardSummaryDto>('/dashboard/my-summary');
    const own = state.sales.filter(
      (x) => x.userId === state.currentUserId && tashkentDate(x.soldAt) === my.businessDate,
    );
    expect(my.businessDate).toBe('2026-10-06');
    expect(my.today).toEqual({
      salesCount: own.length,
      soldQuantity: sumQty(own.map((x) => x.totalQuantity)),
      salesAmount: sumMoney(own.map((x) => x.totalAmount)),
    });
    const me = state.users.find((u) => u.id === state.currentUserId)!;
    expect(my.warehouses.every((w) => me.warehouseIds.includes(w.id))).toBe(true);
  });

  it('sana majburiy va ≤ 366 kun; ombor qoldig‘i sanasiz; noto‘g‘ri saralash/holat → 400 (D-21)', async () => {
    expect(await fails('/reports/sales')).toMatchObject({
      status: 400,
      details: [{ field: 'dateFrom' }, { field: 'dateTo' }],
    });
    expect(
      await fails('/reports/sales', { dateFrom: '2025-10-01', dateTo: '2026-10-02' }),
    ).toMatchObject({ status: 400, details: [{ field: 'dateTo' }] });
    expect(await fails('/reports/finance-summary')).toMatchObject({ status: 400 });
    expect(await fails('/reports/sales', { ...range, sort: 'stock:desc' })).toMatchObject({
      status: 400,
      details: [{ field: 'sort' }],
    });
    expect(await fails('/reports/products', { ...range, status: 'PAID' })).toMatchObject({
      status: 400,
    });
    expect(await fails('/reports/nomalum', range)).toMatchObject({ status: 404 });
    const stock = await get<ReportResponse>('/reports/warehouse-stock');
    expect(stock.meta.total).toBe(Object.keys(state.stock).length);
  });

  it('sotuvlar hisoboti yig‘masi mock holatidan mustaqil hisob bilan teng; userlar hisobotida ham', async () => {
    const sales = salesInRange();
    const revenue = sumMoney(sales.map((x) => x.totalAmount));
    const cost = sumMoney(sales.map((x) => x.totalCost));
    const report = await get<ReportResponse>('/reports/sales', range);
    expect(report.meta.total).toBe(sales.length);
    expect(summaryOf(report)).toEqual({
      count: String(sales.length),
      revenue,
      cost,
      profit: subMoney(revenue, cost),
    });
    const users = await get<ReportResponse>('/reports/user-sales', range);
    expect(summaryOf(users)).toMatchObject({ count: String(sales.length), revenue });
  });

  it('moliyaviy xulosa: tushum − tannarx − xarajat; ombor tanlansa xarajat va sof foyda — null', async () => {
    const sales = salesInRange();
    const revenue = sumMoney(sales.map((x) => x.totalAmount));
    const cost = sumMoney(sales.map((x) => x.totalCost));
    const expenses = sumMoney(
      state.expenses
        .filter((e) => !e.deletedAt && e.date >= range.dateFrom && e.date <= range.dateTo)
        .map((e) => e.amount),
    );
    const finance = await get<FinanceSummaryDto>('/reports/finance-summary', range);
    expect(finance).toMatchObject({
      salesCount: sales.length,
      revenue,
      costOfGoodsSold: cost,
      grossProfit: subMoney(revenue, cost),
      expenses,
      netProfit: subMoney(subMoney(revenue, cost), expenses),
    });
    const report = await get<ReportResponse>('/reports/expenses', range);
    expect(summaryOf(report).expenses).toBe(expenses);
    expect(sumMoney((report.groups ?? []).map((g) => g.amount))).toBe(expenses);

    const warehouseId = state.warehouses[0]!.id;
    const byWarehouse = await get<FinanceSummaryDto>('/reports/finance-summary', {
      ...range,
      warehouseId,
    });
    const own = sales.filter((x) => x.warehouseId === warehouseId);
    expect(byWarehouse).toMatchObject({
      warehouseId,
      salesCount: own.length,
      revenue: sumMoney(own.map((x) => x.totalAmount)),
      expenses: null,
      netProfit: null,
    });
  });

  it('grafik faqat 7/14/30 kun; top mahsulotlar summa bo‘yicha, limit 1–20', async () => {
    expect(await fails('/dashboard/sales-trend', { days: '10' })).toMatchObject({ status: 400 });
    expect(await get<SalesTrendPoint[]>('/dashboard/sales-trend', { days: '7' })).toHaveLength(7);
    expect(await fails('/dashboard/top-products', { limit: '0' })).toMatchObject({ status: 400 });
    const top = await get<TopProductDto[]>('/dashboard/top-products', { limit: '3' });
    expect(top.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < top.length; i++) {
      expect(Number(top[i - 1]!.amount)).toBeGreaterThanOrEqual(Number(top[i]!.amount));
    }
    const summary = await get<DashboardSummaryDto>('/dashboard/summary');
    expect(sumQty(summary.warehouse.byUnit.map((u) => u.quantity))).toBe(
      summary.warehouse.totalQuantity,
    );
  });

  it('sozlamalar: faqat 3 maydon; chegara normallashtiriladi; eski mock maydonlari → 400', async () => {
    const patch = (body: unknown) =>
      mockRequest<SettingsDto>('/settings', { method: 'PATCH', body });
    expect(Object.keys(await get<SettingsDto>('/settings')).sort()).toEqual([
      'companyName',
      'currencyLabel',
      'lowStockDefaultThreshold',
    ]);
    expect(await patch({ lowStockDefaultThreshold: '7.500' })).toMatchObject({
      lowStockDefaultThreshold: '7.5',
    });
    for (const body of [{}, { legalName: 'MChJ' }, { lowStockDefaultThreshold: '-1' }]) {
      await expect(patch(body)).rejects.toMatchObject({ status: 400 });
    }
  });
});

describe('audit jurnali (Phase 13 — backend bilan bir xil amallar va cursor)', () => {
  const patch = <T>(path: string, body: unknown) => mockRequest<T>(path, { method: 'PATCH', body });
  const audit = (query: Record<string, string> = {}) => get<AuditLogPage>('/audit-logs', query);
  const fails = (path: string, query?: Record<string, string>) =>
    get(path, query).catch((e: unknown) => e);

  it('mutatsiya → amal, actor, obyekt va metadata; o‘zgarishsiz PATCH — audit yo‘q; sotuvchi → 403', async () => {
    const group = state.groups[0]!;
    const product = await post<ProductDto>('/products', {
      name: 'Audit mahsulot',
      groupId: group.id,
      costPrice: '600',
      salePrice: '1000',
      unit: 'DONA',
      allowDecimal: false,
    });
    const [created] = (await audit({ entityType: 'PRODUCT', entityId: product.id })).data;
    expect(created).toMatchObject({
      action: 'PRODUCT_CREATED',
      actor: { id: state.currentUserId },
      entityId: product.id,
      metadata: { name: 'Audit mahsulot', salePrice: '1000', costPrice: '600' },
    });
    await patch(`/products/${product.id}`, { salePrice: '1000.00' });
    expect((await audit({ entityId: product.id })).data).toHaveLength(1);
    await patch(`/products/${product.id}`, { salePrice: '1200', status: 'INACTIVE' });
    const actions = (await audit({ entityId: product.id })).data.map((e) => e.action);
    expect(actions).toEqual(['PRODUCT_STATUS_CHANGED', 'PRODUCT_UPDATED', 'PRODUCT_CREATED']);
    const [, updated] = (await audit({ entityId: product.id })).data;
    expect(updated!.metadata.changes).toEqual({
      status: { from: 'ACTIVE', to: 'INACTIVE' },
      salePrice: { from: '1000.00', to: '1200' },
    });

    state.currentUserId = state.users.find((u) => u.login === 'aziz')!.id;
    expect(await fails('/audit-logs')).toMatchObject({ status: 403 });
  });

  it('sotuv yangi mijoz bilan: CUSTOMER_CREATED (source: sale) + SALE_CREATED; xato login — actor yo‘q', async () => {
    const warehouse = state.warehouses[0]!;
    const productId = Object.entries(state.stock)
      .find(([key, qty]) => key.startsWith(`${warehouse.id}|`) && Number(qty) >= 1)![0]
      .split('|')[1]!;
    const product = state.products.find((p) => p.id === productId)!;
    await post<SaleDto>(
      '/sales',
      {
        warehouseId: warehouse.id,
        customer: { name: 'Audit mijoz' },
        items: [{ productId, quantity: product.allowDecimal ? '1.000' : '1' }],
      },
      { 'Idempotency-Key': '01990000-0000-7000-8000-0000000000a1' },
    );
    const latest = (await audit({ limit: '2' })).data;
    expect(latest.map((e) => e.action).sort()).toEqual(['CUSTOMER_CREATED', 'SALE_CREATED']);
    expect(latest.find((e) => e.action === 'CUSTOMER_CREATED')!.metadata).toEqual({
      hasPhone: false,
      hasNotes: false,
      source: 'sale',
    });
    await post('/auth/login', { login: 'yoqlogin', password: '000000' }).catch(() => undefined);
    const [failed] = (await audit({ action: 'AUTH_LOGIN_FAILED' })).data;
    // SEC-01: noma'lum login xom holda yozilmaydi (backend kabi; mock'da kalit yo'q — iz ham yo'q).
    expect(failed).toMatchObject({
      actor: null,
      entityType: 'SESSION',
      metadata: { loginLength: 8, reason: 'INVALID_CREDENTIALS', knownUser: false },
    });
    expect(JSON.stringify(failed)).not.toContain('yoqlogin');
    // Login maydoniga parol yozilsa — faqat maska.
    await post('/auth/login', { login: '582913', password: '000000' }).catch(() => undefined);
    const [masked] = (await audit({ action: 'AUTH_LOGIN_FAILED' })).data;
    expect(masked!.metadata).toEqual({
      loginMasked: true,
      loginLength: 6,
      reason: 'INVALID_CREDENTIALS',
      knownUser: false,
    });
  });

  it('cursor: takrorsiz va to‘liq; yangilari birinchi; buzilgan cursor va limit → 400', async () => {
    for (let i = 1; i <= 5; i++) await post('/product-groups', { name: `Audit guruh ${i}` });
    const collected: string[] = [];
    let cursor: string | null = null;
    do {
      const page: AuditLogPage = await audit({
        action: 'PRODUCT_GROUP_CREATED',
        limit: '2',
        ...(cursor ? { cursor } : {}),
      });
      collected.push(...page.data.map((e) => String(e.metadata.name)));
      cursor = page.nextCursor;
    } while (cursor);
    expect(collected).toEqual([5, 4, 3, 2, 1].map((i) => `Audit guruh ${i}`));
    expect(await fails('/audit-logs', { cursor: 'buzilgan' })).toMatchObject({ status: 400 });
    expect(await fails('/audit-logs', { limit: '101' })).toMatchObject({ status: 400 });
    expect(await fails('/audit-logs/abc')).toMatchObject({ status: 400 });
    expect(await fails('/audit-logs/999999')).toMatchObject({ status: 404 });
  });
});
