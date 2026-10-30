// Divine.uz — drill: tiklangan tizimni ILOVA orqali tekshirish (Phase 17). Chiqish: JSON.
//   node scripts/prod/drill-check.mjs --url https://127.0.0.1:18443 --login <admin> --password-file <fayl> [--insecure]
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string' },
    login: { type: 'string' },
    'password-file': { type: 'string' },
    insecure: { type: 'boolean', default: false },
  },
});
if (args.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const base = `${args.url}/api/v1`;
const res = await fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login: args.login, password: readFileSync(args['password-file'], 'utf8').trim() }),
});
if (!res.ok) throw new Error(`login → ${res.status}`);
const auth = { Authorization: `Bearer ${(await res.json()).accessToken}` };
const get = async (path) => {
  const r = await fetch(`${base}${path}`, { headers: auth });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
};
const sales = await get('/sales?pageSize=1');
const recon = await get('/inventory/reconciliation');
const warehouses = await get('/warehouses?pageSize=100');
const audit = await get('/audit-logs?limit=1');
console.log(
  JSON.stringify({
    sales: sales.meta.total,
    reconciliationIssues: recon.mismatchCount + recon.documentIssueCount + recon.customerIssueCount,
    warehouses: warehouses.data.map((w) => w.name).sort(),
    auditReadable: audit.data.length === 1,
  }),
);
