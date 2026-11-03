import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { t } from '@/i18n/uz';
import { db } from '@/mocks/db';
import { MOCK_DEMO_PASSWORD } from '@/mocks/handlers/auth.constants';
import { mockRequest } from '@/mocks';
import { setMockNow } from '@/mocks/lib/clock';
import { failRoutes, restoreRoutes } from '@/test/fail-routes';
import { PAGE, renderApp } from '@/test/render-app';
import type { ExpenseCategoryDto } from '@/shared/types/api';

afterEach(restoreRoutes);

async function loginAs(login: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(t.auth.login, {}, PAGE), login);
  await user.type(
    screen.getByLabelText(t.auth.password, { selector: 'input' }),
    MOCK_DEMO_PASSWORD,
  );
  await user.click(screen.getByRole('button', { name: t.auth.submit }));
  return user;
}

function as(login: string) {
  const s = db();
  s.currentUserId = s.users.find((u) => u.login === login)!.id;
  return s;
}

describe('Xarajatlar: sotuvchi — faqat o‘zi qo‘shganlari (D-23)', () => {
  it('admin xarajatlari va kategoriyalari ko‘rinmaydi; kategoriya yo‘q — nom yozib qo‘shadi va shu xarajatga tanlanadi', async () => {
    renderApp('/login?redirect=%2Fexpenses', { loggedOut: true });
    const user = await loginAs('aziz');
    setMockNow(new Date());

    expect(
      await screen.findByRole('heading', { level: 1, name: t.nav.expenses }, PAGE),
    ).toBeInTheDocument();
    expect(screen.getByText(t.expenses.own.description)).toBeInTheDocument();
    // Seed'dagi barcha xarajatlar adminniki — sotuvchi ro'yxati bo'sh.
    expect(await screen.findByText(t.expenses.emptyTitle, {}, PAGE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.expenses.categories.open })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: t.expenses.col.createdBy })).toBeNull();

    const before = db().expenses.length;
    await user.click(screen.getAllByRole('button', { name: t.expenses.add })[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    // Sotuvchida kategoriya yo'q — ro'yxat o'rniga darhol nom maydoni.
    const name = await within(dialog).findByPlaceholderText(
      t.expenses.form.newCategoryPlaceholder,
      {},
      PAGE,
    );
    expect(within(dialog).queryByRole('combobox', { name: /Kategoriya/ })).toBeNull();
    await user.type(
      within(dialog).getByLabelText(t.expenses.form.amount, { exact: false }),
      '45000',
    );
    // Bo'sh nom bilan saqlash — kategoriya majburiy.
    await user.click(within(dialog).getByRole('button', { name: t.common.add }));
    expect(await within(dialog).findByText('Kategoriyani tanlang', {}, PAGE)).toBeInTheDocument();
    expect(db().expenses.length).toBe(before);

    await user.type(name, 'Tushlik');
    await user.keyboard('{Enter}');
    // Qo'shildi va tanlandi — endi ro'yxat (combobox) ko'rinadi.
    const combobox = await within(dialog).findByRole('combobox', { name: /Kategoriya/ }, PAGE);
    expect(combobox).toHaveTextContent('Tushlik');
    const aziz = db().users.find((u) => u.login === 'aziz')!;
    const category = db().expenseCategories.find((c) => c.name === 'Tushlik')!;
    expect(category.createdBy).toBe(aziz.id);

    await user.click(within(dialog).getByRole('button', { name: t.common.add }));
    await waitFor(() => expect(db().expenses.length).toBe(before + 1), PAGE);
    expect(db().expenses.at(-1)).toMatchObject({
      amount: '45000.00',
      categoryId: category.id,
      createdBy: aziz.id,
    });
    // Ro'yxatda faqat o'z xarajati.
    const table = await screen.findByRole('table', {}, PAGE);
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2), PAGE);
  });

  it('"+ Yangi kategoriya" — ro‘yxatning eng pastida; admin kategoriyasi tanlovda yo‘q; bir xil nom → xato', async () => {
    renderApp('/login?redirect=%2Fexpenses', { loggedOut: true });
    const s = db();
    const aziz = s.users.find((u) => u.login === 'aziz')!;
    const at = new Date().toISOString();
    s.expenseCategories.push({
      id: '01990000-0000-7000-8000-00000000a201',
      name: 'Yetkazib berish',
      isActive: true,
      createdBy: aziz.id,
      createdAt: at,
      updatedAt: at,
    });
    const adminCategory = s.expenseCategories.find((c) => !c.createdBy && c.isActive)!;
    const user = await loginAs('aziz');
    await user.click(await screen.findByRole('button', { name: t.expenses.add }, PAGE));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('combobox', { name: /Kategoriya/ }, PAGE));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual(['Yetkazib berish', t.expenses.form.newCategory]);
    expect(options).not.toContain(adminCategory.name);

    await user.click(screen.getByRole('option', { name: t.expenses.form.newCategory }));
    const name = await within(dialog).findByPlaceholderText(t.expenses.form.newCategoryPlaceholder);
    await user.type(name, 'yetkazib BERISH');
    await user.click(within(dialog).getByRole('button', { name: t.expenses.form.addCategory }));
    expect(
      await within(dialog).findByText('Bu nom allaqachon mavjud', {}, PAGE),
    ).toBeInTheDocument();
    // Ro'yxatga qaytish.
    await user.click(
      within(dialog).getByRole('button', { name: t.expenses.form.cancelNewCategory }),
    );
    expect(within(dialog).getByRole('combobox', { name: /Kategoriya/ })).toBeInTheDocument();
  });
});

describe('Xarajatlar: admin (D-19)', () => {
  it('to‘liq ro‘yxat, "Jami" va kategoriyalar tugmasi', async () => {
    renderApp('/expenses');
    expect(await screen.findByText(t.expenses.summary.total, {}, PAGE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.expenses.categories.open })).toBeInTheDocument();
  });

  it('qatorni bosib tahrirlaydi: summa o‘zgaradi, sana, kategoriya va izoh saqlanadi', async () => {
    renderApp('/expenses');
    const user = userEvent.setup();
    const table = await screen.findByRole('table', {}, PAGE);
    await waitFor(() => expect(within(table).getAllByRole('row').length).toBeGreaterThan(1), PAGE);
    const latest = [...db().expenses]
      .filter((e) => !e.deletedAt)
      .sort((a, b) => `${b.date}|${b.createdAt}`.localeCompare(`${a.date}|${a.createdAt}`))[0]!;
    const original = { ...latest };
    await user.click(within(table).getAllByRole('row')[1] as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByLabelText(t.expenses.form.amount, { exact: false });
    await user.clear(amount);
    await user.type(amount, '123456');
    await user.click(within(dialog).getByRole('button', { name: t.common.saveChanges }));
    await waitFor(() => expect(latest.amount).toBe('123456.00'), PAGE);
    expect(latest).toMatchObject({
      date: original.date,
      categoryId: original.categoryId,
      note: original.note,
    });
  });

  it('kategoriyalar oynasi: qo‘shish, takroriy nom xatosi, nofaol qilish, xarajatsizini o‘chirish', async () => {
    renderApp('/expenses');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: t.expenses.categories.open }, PAGE));
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByRole('textbox', { name: t.expenses.categories.name });

    await user.type(input, 'Internet');
    await user.click(within(dialog).getByRole('button', { name: t.common.add }));
    await waitFor(
      () => expect(db().expenseCategories.some((c) => c.name === 'Internet')).toBe(true),
      PAGE,
    );

    await user.type(input, 'internet');
    await user.click(within(dialog).getByRole('button', { name: t.common.add }));
    expect(await within(dialog).findByText('Bu nom allaqachon mavjud', {}, PAGE)).toBeVisible();

    await user.click(
      within(dialog).getByRole('switch', { name: t.expenses.categories.activeToggle('Internet') }),
    );
    // Phase 14: nofaol qilish tasdiq so'raydi — tasdiqlanmaguncha o'zgarmaydi.
    const deactivate = await screen.findByRole('alertdialog');
    expect(
      within(deactivate).getByText(t.expenses.categories.deactivateTitle('Internet')),
    ).toBeInTheDocument();
    expect(db().expenseCategories.find((c) => c.name === 'Internet')?.isActive).not.toBe(false);
    await user.click(
      within(deactivate).getByRole('button', { name: t.expenses.categories.deactivate }),
    );
    await waitFor(
      () => expect(db().expenseCategories.find((c) => c.name === 'Internet')?.isActive).toBe(false),
      PAGE,
    );

    const used = db().expenseCategories.find((c) => c.name === 'Ijara')!;
    expect(
      within(dialog).getByRole('button', { name: t.expenses.categories.remove(used.name) }),
    ).toBeDisabled();
    await user.click(
      within(dialog).getByRole('button', { name: t.expenses.categories.remove('Internet') }),
    );
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: t.common.delete }));
    await waitFor(
      () => expect(db().expenseCategories.some((c) => c.name === 'Internet')).toBe(false),
      PAGE,
    );
  });
});

describe('mock API backend bilan bir xil (RBAC §5, D-12, D-19)', () => {
  it('sotuvchi: kategoriyalar faqat faol va `id, name`; ro‘yxat, detal, tahrirlash, o‘chirish, kategoriya boshqaruvi 403', async () => {
    renderApp('/login?redirect=%2Fsales', { loggedOut: true });
    const s = as('aziz');
    s.expenseCategories[0]!.isActive = false;
    const list = await mockRequest<ExpenseCategoryDto[]>('/expense-categories', {
      query: { isActive: 'false' },
    });
    expect(list.length).toBe(s.expenseCategories.filter((c) => c.isActive).length);
    for (const c of list) expect(Object.keys(c).sort()).toEqual(['id', 'name']);

    const id = s.expenses[0]!.id;
    for (const [path, method] of [
      ['/expenses', 'GET'],
      [`/expenses/${id}`, 'GET'],
      [`/expenses/${id}`, 'PATCH'],
      [`/expenses/${id}`, 'DELETE'],
      ['/expense-categories', 'POST'],
      [`/expense-categories/${list[0]!.id}`, 'PATCH'],
      [`/expense-categories/${list[0]!.id}`, 'DELETE'],
    ] as const) {
      await expect(
        mockRequest(path, { method, body: { amount: '1', name: 'X' } }),
      ).rejects.toMatchObject({ status: 403 });
    }
  });
});

describe('Xarajat formasi: kategoriyalar yuklanmasa (Phase 14, REQ-154)', () => {
  it('"kategoriya yo‘q" emas — xato va qayta urinish; qayta urinishda ro‘yxat keladi', async () => {
    failRoutes(['/expense-categories']);
    renderApp('/expenses');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: t.expenses.add }, PAGE));
    const dialog = await screen.findByRole('dialog', {}, PAGE);
    const alert = await within(dialog).findByText(t.common.optionsLoadFailed, {}, PAGE);
    // Yuklanmagan ro'yxat — "kategoriya yo'q" deb nom maydoniga o'tilmaydi.
    expect(
      within(dialog).queryByPlaceholderText(t.expenses.form.newCategoryPlaceholder),
    ).toBeNull();

    restoreRoutes();
    await user.click(within(alert).getByRole('button', { name: t.common.retry }));
    await waitFor(() => expect(within(dialog).queryByText(t.common.optionsLoadFailed)).toBeNull());
  });
});
