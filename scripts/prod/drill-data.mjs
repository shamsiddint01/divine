// Divine.uz — backup/restore drill uchun ma'lumot (Phase 17, docs/RUNBOOK.md §6). Faqat sinov stack'ida!
// Hamma narsa HAQIQIY HTTPS API orqali (ledger, audit, trigger'lar real yo'ldan to'ladi):
//
//   node scripts/prod/drill-data.mjs --url https://127.0.0.1:18443 --login <admin> --password-file <fayl> \
//        --tag A --sales 25 [--insecure]
//
// --insecure — self-signed drill sertifikati uchun (sertifikat zanjiri tekshirilmaydi). Chiqish: JSON xulosa.
// Parol argument emas, fayldan o'qiladi (jarayonlar ro'yxatida ko'rinmasin).
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string' },
    login: { type: 'string' },
    'password-file': { type: 'string' },
    tag: { type: 'string', default: 'A' },
    sales: { type: 'string', default: '25' },
    insecure: { type: 'boolean', default: false },
  },
});
if (!args.url || !args.login || !args['password-file']) {
  console.error('foydalanish: --url --login --password-file [--tag] [--sales] [--insecure]');
  process.exit(2);
}
if (args.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const base = `${args.url}/api/v1`;
const origin = args.url;
const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10); // Toshkent kuni

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
const login = async (loginName, password) =>
  (await call('POST', '/auth/login', { body: { login: loginName, password } })).accessToken;

const tag = args.tag;
const admin = await login(args.login, readFileSync(args['password-file'], 'utf8').trim());
const warehouse = await call('POST', '/warehouses', { token: admin, body: { name: `Drill ombor ${tag}` } });
const group = await call('POST', '/product-groups', { token: admin, body: { name: `Drill guruh ${tag}` } });
const products = [];
for (let i = 1; i <= 5; i++) {
  products.push(
    await call('POST', '/products', {
      token: admin,
      body: {
        name: `Drill mahsulot ${tag}${i}`,
        groupId: group.id,
        barcode: `47${String(Date.now()).slice(-8)}${i}${tag.charCodeAt(0) % 10}`,
        costPrice: `${1000 * i}.00`,
        salePrice: `${1500 * i}.00`,
        unit: 'DONA',
        allowDecimal: false,
      },
    }),
  );
}
const incoming = await call('POST', '/incoming', {
  token: admin,
  body: {
    date: today,
    warehouseId: warehouse.id,
    items: products.map((p, i) => ({ productId: p.id, quantity: '100', costPrice: `${1000 * (i + 1)}.00` })),
  },
});
await call('POST', `/incoming/${incoming.id}/confirm`, { token: admin });

const created = await call('POST', '/users', {
  token: admin,
  body: { login: `drillkassir${tag}${Date.now().toString(36).slice(-4)}`, role: 'USER', warehouseIds: [warehouse.id] },
});
const seller = await login(created.user.login, created.generatedPassword);
const count = Number(args.sales);
for (let i = 0; i < count; i++) {
  await call('POST', '/sales', {
    token: seller,
    headers: { 'Idempotency-Key': randomUUID() },
    body: {
      warehouseId: warehouse.id,
      customer: { name: `Drill mijoz ${tag}${i}`, phone: i % 2 ? null : `+99890${String(1000000 + i)}` },
      items: [
        { productId: products[i % 5].id, quantity: '2' },
        { productId: products[(i + 1) % 5].id, quantity: '1' },
      ],
    },
  });
}
const category = await call('POST', '/expense-categories', { token: admin, body: { name: `Drill xarajat ${tag}` } });
await call('POST', '/expenses', {
  token: admin,
  body: { date: today, amount: '125000.00', categoryId: category.id, note: `Drill ${tag}` },
});
const sales = await call('GET', `/sales?warehouseId=${warehouse.id}&pageSize=1`, { token: admin });
console.log(
  JSON.stringify({ tag, warehouseId: warehouse.id, products: products.length, sales: sales.meta?.total ?? null }),
);
