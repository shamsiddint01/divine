import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { t } from '../src/i18n/uz';

/*
 * Asosiy oqimlar (Phase 15, REQ-172; TZ §19) — haqiqiy backend, toza DB (`global-setup.ts`).
 * Bitta ketma-ket ssenariy: admin katalog va sotuvchini yaratadi, kirim qiladi; sotuvchi sotadi;
 * admin tarix, hisobot va auditni ko'radi. Har bir qadam o'zbekcha UI matnlari orqali (AC-25).
 */
const ADMIN = {
  login: process.env.E2E_ADMIN_LOGIN ?? '',
  password: process.env.E2E_ADMIN_PASSWORD ?? '',
};
const RUN = Date.now().toString(36).slice(-5);
const WAREHOUSE = `E2E ombor ${RUN}`;
const GROUP = `E2E guruh ${RUN}`;
const BARCODE = `478${String(Date.now()).slice(-9)}`;
const PRODUCT_A = {
  name: `E2E telefon ${RUN}`,
  barcode: `${BARCODE}1`,
  cost: '10000',
  sale: '15000',
};
const PRODUCT_B = {
  name: `E2E quloqchin ${RUN}`,
  barcode: `${BARCODE}2`,
  cost: '2000',
  sale: '3500',
};
const SELLER_LOGIN = `kassir${RUN}`;
const CUSTOMER = `E2E Mijoz ${RUN}`;
let sellerPassword = '';

async function login(page: Page, credentials: { login: string; password: string }) {
  await page.goto('/login');
  await page.locator('#login-login').fill(credentials.login);
  await page.locator('#login-password').fill(credentials.password);
  await page.getByRole('button', { name: t.auth.submit }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Radix Select: trigger → variant. */
async function choose(page: Page, triggerId: string, option: string) {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function apiToken(
  request: APIRequestContext,
  credentials: { login: string; password: string },
) {
  const res = await request.post('/api/v1/auth/login', { data: credentials });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

test.describe.serial('Asosiy oqim: katalog → kirim → sotuv → hisobot → audit', () => {
  let browser: Browser;
  let admin: Page;

  test.beforeAll(async ({ browser: b }) => {
    expect(ADMIN.password, 'global-setup admin parolini bermadi').toMatch(/^\d{6}$/);
    browser = b;
    admin = await (await browser.newContext()).newPage();
  });

  test('kirish: noto‘g‘ri parol — umumiy o‘zbekcha xato; to‘g‘ri parol — bosh sahifa', async () => {
    await admin.goto('/login');
    await admin.getByRole('button', { name: t.auth.submit }).click();
    await expect(admin.getByText('Loginni kiriting')).toBeVisible();
    await admin.locator('#login-login').fill(ADMIN.login);
    await admin.locator('#login-password').fill(ADMIN.password === '000000' ? '111111' : '000000');
    await admin.getByRole('button', { name: t.auth.submit }).click();
    await expect(admin.getByText('Login yoki parol noto‘g‘ri')).toBeVisible();
    await login(admin, ADMIN);
    await expect(admin.getByRole('heading', { level: 1 })).toContainText(
      t.dashboard.greeting(ADMIN.login).split(',')[0]!,
    );
  });

  test('admin: ombor, guruh va 2 ta mahsulot (shtrix-kod takrorlanmaydi)', async () => {
    await admin.goto('/warehouses');
    await admin.getByRole('button', { name: t.warehouses.add }).first().click();
    await admin.locator('#w-name').fill(WAREHOUSE);
    await admin.getByRole('button', { name: t.common.create }).click();
    await expect(admin.getByRole('link', { name: WAREHOUSE })).toBeVisible();

    await admin.goto('/product-groups');
    await admin.getByRole('button', { name: t.groups.add }).first().click();
    await admin.locator('#g-name').fill(GROUP);
    await admin.getByRole('button', { name: t.common.create }).click();
    await expect(admin.getByRole('cell', { name: GROUP })).toBeVisible();

    await admin.goto('/products');
    for (const p of [PRODUCT_A, PRODUCT_B]) {
      await admin.getByRole('button', { name: t.products.add }).first().click();
      await admin.locator('#p-name').fill(p.name);
      await choose(admin, 'p-group', GROUP);
      await admin.locator('#p-barcode').fill(p.barcode);
      await admin.locator('#p-cost').fill(p.cost);
      await admin.locator('#p-sale').fill(p.sale);
      await admin.getByRole('button', { name: t.common.create }).click();
      await expect(admin.getByRole('dialog')).toBeHidden();
    }
    // Takroriy shtrix-kod (BR-10): server 409, maydon ostida o'zbekcha xabar.
    await admin.getByRole('button', { name: t.products.add }).first().click();
    await admin.locator('#p-name').fill(`${PRODUCT_A.name} nusxa`);
    await choose(admin, 'p-group', GROUP);
    await admin.locator('#p-barcode').fill(PRODUCT_A.barcode);
    await admin.locator('#p-cost').fill('1');
    await admin.locator('#p-sale').fill('2');
    await admin.getByRole('button', { name: t.common.create }).click();
    await expect(admin.getByRole('dialog').getByRole('alert')).toContainText(/shtrix-kod/i);
    await admin.keyboard.press('Escape');
  });

  test('admin: sotuvchi yaratadi — parol 6 raqam, faqat bir marta ko‘rsatiladi', async () => {
    await admin.goto('/users');
    await admin.getByRole('button', { name: t.users.add }).first().click();
    await admin.locator('#u-login').fill(SELLER_LOGIN);
    await admin.locator('#u-name').fill('E2E Kassir');
    await admin.getByRole('switch', { name: WAREHOUSE }).click();
    await admin.getByRole('button', { name: t.common.create }).click();
    const reveal = admin.getByRole('dialog', { name: t.users.password.title });
    await expect(reveal).toBeVisible();
    sellerPassword = (await reveal.locator('.font-mono').innerText()).replace(/\s/g, '');
    expect(sellerPassword).toMatch(/^\d{6}$/);
    await reveal.getByRole('button', { name: t.users.password.done }).click();
    await expect(admin.getByText(sellerPassword)).toHaveCount(0);
  });

  test('admin: kirim — jami miqdor dinamik (50 + 30 = 80 → 90), tasdiqlansa qoldiq oshadi', async () => {
    await admin.goto('/incoming/new');
    await choose(admin, 'in-warehouse', WAREHOUSE);
    const barcode = admin.getByLabel(t.incoming.form.barcode);
    for (const code of [PRODUCT_A.barcode, PRODUCT_B.barcode]) {
      await barcode.fill(code);
      await barcode.press('Enter');
    }
    const total = admin.getByTestId('incoming-total-quantity');
    await admin.getByLabel(`${t.incoming.form.quantity} 1`, { exact: true }).fill('50');
    await admin.getByLabel(`${t.incoming.form.quantity} 2`, { exact: true }).fill('30');
    await expect(total).toHaveText(t.incoming.form.totalQuantityValue('80'));
    await admin.getByLabel(`${t.incoming.form.quantity} 1`, { exact: true }).fill('60');
    await expect(total).toHaveText(t.incoming.form.totalQuantityValue('90'));

    await admin.getByRole('button', { name: t.incoming.form.confirm }).click();
    const dialog = admin.getByRole('alertdialog');
    await expect(dialog).toContainText(t.incoming.form.confirmTitle);
    await dialog.getByRole('button', { name: t.common.confirm }).click();
    await expect(admin.getByText(t.incoming.form.confirmed)).toBeVisible();

    await admin.goto('/warehouses');
    const card = admin.locator('[data-slot=card]', { hasText: WAREHOUSE });
    await expect(card).toContainText('90');
  });

  test('sotuvchi: mijoz ismisiz rad; ism bilan sotuv (telefonsiz) — qoldiq kamayadi; admin bo‘limi yopiq', async () => {
    const seller = await (await browser.newContext()).newPage();
    await login(seller, { login: SELLER_LOGIN, password: sellerPassword });
    await expect(seller.getByRole('navigation').getByRole('link')).toHaveCount(4);

    await seller.goto('/sales');
    const card = seller.getByRole('button', { name: new RegExp(PRODUCT_A.name) });
    await expect(card).toContainText('60');
    await card.click();
    await seller.getByRole('button', { name: t.sales.confirm }).click();
    await expect(seller.getByText('Mijoz ismi majburiy')).toBeVisible();

    await seller.locator('#pos-customer').fill(CUSTOMER);
    await seller.getByRole('button', { name: t.sales.confirm }).click();
    const receipt = seller.getByRole('dialog', { name: t.sales.receipt.title });
    await expect(receipt).toContainText(CUSTOMER);
    await expect(receipt).toContainText('15 000');
    await receipt.getByRole('button', { name: t.common.close }).first().click();
    await expect(seller.getByRole('button', { name: new RegExp(PRODUCT_A.name) })).toContainText(
      '59',
    );

    await seller.goto('/users');
    await expect(seller.getByRole('heading', { name: t.forbidden.title })).toBeVisible();
    await seller.context().close();
  });

  test('API: qoldiqdan ko‘p sotish rad etiladi (409), hech narsa o‘zgarmaydi; sotuvchi admin API’siga 403', async ({
    request,
  }) => {
    const token = await apiToken(request, { login: SELLER_LOGIN, password: sellerPassword });
    const auth = { Authorization: `Bearer ${token}` };
    const products = await (
      await request.get('/api/v1/products', { headers: auth, params: { search: PRODUCT_A.name } })
    ).json();
    const product = products.data[0] as { id: string; stock: string };
    const warehouses = await (await request.get('/api/v1/warehouses', { headers: auth })).json();
    const sale = await request.post('/api/v1/sales', {
      headers: { ...auth, 'Idempotency-Key': crypto.randomUUID() },
      data: {
        warehouseId: warehouses.data[0].id,
        customer: { name: CUSTOMER, phone: null },
        items: [{ productId: product.id, quantity: '1000' }],
      },
    });
    expect(sale.status()).toBe(409);
    expect((await sale.json()).error.code).toBe('INSUFFICIENT_STOCK');
    const after = await (
      await request.get(`/api/v1/products/${product.id}`, { headers: auth })
    ).json();
    expect(after.stock).toBe(product.stock);
    expect((await request.get('/api/v1/users', { headers: auth })).status()).toBe(403);
  });

  test('xavfsizlik (Phase 16): sotuvchi brauzerda admin sahifalari va devtools’dagi so‘rovlar bilan ham kira olmaydi; token saqlanmaydi', async () => {
    const seller = await (await browser.newContext()).newPage();
    const adminCalls: string[] = [];
    seller.on('response', (res) => {
      const path = new URL(res.url()).pathname;
      const adminOnly =
        /^\/api\/v1\/(users|incoming|reports|audit-logs|settings|inventory|dashboard\/summary)/.test(
          path,
        ) || /^\/api\/v1\/(warehouses|product-groups|customers)\/[^/]+/.test(path);
      if (adminOnly && res.status() < 300) adminCalls.push(`${res.status()} ${path}`);
    });
    await login(seller, { login: SELLER_LOGIN, password: sellerPassword });

    for (const route of [
      '/users',
      '/product-groups',
      '/warehouses',
      '/customers',
      '/incoming',
      '/incoming/new',
      '/reports',
      '/settings',
      '/settings?tab=audit',
    ]) {
      await seller.goto(route);
      await expect(seller.getByRole('heading', { name: t.forbidden.title }), route).toBeVisible();
    }
    await seller.goto('/products');
    await expect(seller.getByRole('table')).toBeVisible();
    await expect(seller.getByText(t.products.col.costPrice)).toHaveCount(0);
    expect(adminCalls).toEqual([]);

    // Token brauzer xotirasida emas; refresh cookie — HttpOnly (JS ko'rmaydi).
    const storage = await seller.evaluate(() => ({
      local: JSON.stringify({ ...localStorage }),
      session: JSON.stringify({ ...sessionStorage }),
      cookie: document.cookie,
    }));
    expect(`${storage.local}${storage.session}`).not.toMatch(/eyJhbGci|accessToken|refresh/i);
    expect(storage.cookie).not.toContain('dv_refresh');

    // Devtools: sotuvchi o'z sessiyasidan token olib, admin API'larini qo'lda chaqiradi.
    const result = await seller.evaluate(async () => {
      const csrf = { 'X-Requested-With': 'XMLHttpRequest' };
      const withoutToken = (await fetch('/api/v1/users', { credentials: 'include' })).status;
      const refreshed = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: csrf,
      });
      const { accessToken } = (await refreshed.json()) as { accessToken: string };
      const auth = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
      const calls: [string, string, object?][] = [
        ['GET', '/api/v1/users'],
        ['POST', '/api/v1/users', { login: 'buzgunchi01', role: 'ADMIN' }],
        ['POST', '/api/v1/products', { name: 'x' }],
        ['PATCH', '/api/v1/settings', { companyName: 'x' }],
        ['GET', '/api/v1/reports/sales?dateFrom=2026-01-01&dateTo=2026-12-31'],
        ['GET', '/api/v1/audit-logs'],
        ['GET', '/api/v1/dashboard/summary'],
        ['POST', '/api/v1/incoming', {}],
        ['GET', '/api/v1/expenses'],
      ];
      const statuses: string[] = [];
      for (const [method, url, body] of calls) {
        const res = await fetch(url, {
          method,
          headers: auth,
          body: body ? JSON.stringify(body) : undefined,
        });
        statuses.push(`${method} ${url.split('?')[0]} ${res.status}`);
      }
      const products = (await (await fetch('/api/v1/products', { headers: auth })).json()) as {
        data: Record<string, unknown>[];
      };
      return {
        withoutToken,
        refresh: refreshed.status,
        statuses,
        costKeys: products.data.filter((p) => 'costPrice' in p).length,
        productCount: products.data.length,
      };
    });
    expect(result.withoutToken).toBe(401);
    expect(result.refresh).toBe(200);
    expect(result.statuses.filter((s) => !s.endsWith(' 403'))).toEqual([]);
    expect(result.productCount).toBeGreaterThan(0);
    expect(result.costKeys).toBe(0);
    await seller.context().close();
  });

  test('admin: sotuvlar tarixi, hisobot (mahsulot + sotuvchi filtri) va audit jurnali', async () => {
    await admin.goto('/sales?tab=history');
    await expect(admin.getByRole('cell', { name: CUSTOMER })).toBeVisible();

    // Hisobot (joriy oy) + mahsulot va sotuvchi filtri birga (AC-17); boshqa mahsulot — natija yo'q.
    await admin.goto('/reports');
    await expect(admin.getByRole('cell', { name: CUSTOMER })).toBeVisible();
    await admin.getByRole('combobox', { name: t.reports.filters.allUsers }).click();
    await admin.getByRole('option', { name: 'E2E Kassir', exact: true }).click();
    await admin.getByRole('combobox', { name: t.reports.filters.allProducts }).click();
    await admin.getByPlaceholder(t.products.searchPlaceholder).fill(PRODUCT_B.name);
    await admin.getByRole('option', { name: new RegExp(PRODUCT_B.name) }).click();
    await expect(admin).toHaveURL(/productId=/);
    await expect(admin.getByRole('cell', { name: CUSTOMER })).toHaveCount(0);
    await admin.getByRole('combobox', { name: t.reports.filters.allProducts }).click();
    await admin.getByPlaceholder(t.products.searchPlaceholder).fill(PRODUCT_A.name);
    await admin.getByRole('option', { name: new RegExp(PRODUCT_A.name) }).click();
    await expect(admin.getByRole('cell', { name: CUSTOMER })).toBeVisible();

    await admin.goto('/settings?tab=audit');
    await expect(
      admin.getByRole('cell', { name: t.audit.actions.SALE_CREATED }).first(),
    ).toBeVisible();
    await expect(
      admin.getByRole('cell', { name: t.audit.actions.INCOMING_CONFIRMED }).first(),
    ).toBeVisible();
    await expect(
      admin.getByRole('cell', { name: t.audit.actions.USER_CREATED }).first(),
    ).toBeVisible();
  });
});
