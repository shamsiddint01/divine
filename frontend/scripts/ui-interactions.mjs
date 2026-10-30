#!/usr/bin/env node
// Divine.uz — real brauzerdagi interaksiya ssenariylari (headless Chrome, CDP).
//   node scripts/ui-interactions.mjs [--base http://localhost:5180]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'http://localhost:5180';
const port = 9800 + Math.floor(Math.random() * 100);
const profile = mkdtempSync(join(tmpdir(), 'divine-ix-'));
/** Chrome to'liq yopilgach vaqtinchalik profilni o'chiradi — aks holda har ishga tushish /tmp'da profil qoldiradi. */
async function stopChrome() {
  const exited = new Promise((resolve) => chrome.once('exit', resolve));
  chrome.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
  await new Promise((resolve) => setTimeout(resolve, 300));
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    /* o'chmasa ham QA natijasiga ta'sir qilmaydi */
  }
}
const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(200);
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(
      (t) => t.type === 'page',
    );
  } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const jsErrors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  } else if (m.method === 'Runtime.exceptionThrown')
    jsErrors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0]);
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++seq;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
await send('Runtime.enable');
await send('Page.enable');
const viewport = (width, height = 900) =>
  send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
const evaluate = async (expr) =>
  (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))
    .result.result?.value;
const go = async (path) => {
  await send('Page.navigate', { url: BASE + path });
  await sleep(1800);
};
const waitFor = async (expr, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(expr)) return true;
    await sleep(150);
  }
  return false;
};
const textOnPage = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`;
const clickText = (t, selector = 'button, a, [role=tab], [role=option], [role=menuitem]') =>
  evaluate(
    `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.offsetParent !== null && (e.innerText.trim() === ${JSON.stringify(t)} || e.getAttribute('aria-label') === ${JSON.stringify(t)})); if (!el) return false; el.click(); return true; })()`,
  );
const typeInto = async (selector, text) => {
  await evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select?.(); return true; })()`,
  );
  await send('Input.insertText', { text });
};
const key = async (k, code = k) => {
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: k,
    code,
    windowsVirtualKeyCode: { Escape: 27, Enter: 13, ArrowDown: 40, ArrowUp: 38 }[k] ?? 0,
  });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code });
};
const dialogOpen = () => evaluate(`!!document.querySelector('[role=dialog], [role=alertdialog]')`);

const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

await viewport(1440);

// 1. Mahsulotlar: qidiruv → URL → refresh'dan keyin saqlanadi; pagination
await go('/products');
await waitFor(`document.querySelectorAll('tbody tr').length > 5`);
await typeInto('input[type=search]', 'Telefon');
await waitFor(`location.search.includes('q=Telefon')`);
await waitFor(
  `[...document.querySelectorAll('tbody tr')].every((r) => r.innerText.includes('Telefon'))`,
);
check(
  'Mahsulotlar: qidiruv natijani filtrlaydi va URL’ga yoziladi',
  await evaluate(`location.search.includes('q=Telefon')`),
);
await send('Page.reload');
await sleep(2000);
check(
  'Mahsulotlar: refresh’dan keyin qidiruv saqlanadi',
  await waitFor(
    `document.querySelector('input[type=search]')?.value === 'Telefon' && document.querySelectorAll('tbody tr').length > 0`,
  ),
);
await go('/products?pageSize=10');
await waitFor(`document.querySelectorAll('tbody tr').length === 10`);
await clickText('Keyingi sahifa');
check('Mahsulotlar: pagination (2-sahifa)', await waitFor(`location.search.includes('page=2')`));
await clickText('Sotuv narxi bo‘yicha saralash');
check(
  'Mahsulotlar: ustun bo‘yicha saralash URL’ga yoziladi',
  await waitFor(`location.search.includes('sort=salePrice')`),
);

// 2. Modal: tashqariga bosish yopmaydi, Escape yopadi
await clickText('Mahsulot qo‘shish');
await waitFor(`!!document.querySelector('[role=dialog]')`);
await send('Input.dispatchMouseEvent', {
  type: 'mousePressed',
  x: 5,
  y: 450,
  button: 'left',
  clickCount: 1,
});
await send('Input.dispatchMouseEvent', {
  type: 'mouseReleased',
  x: 5,
  y: 450,
  button: 'left',
  clickCount: 1,
});
await sleep(300);
check('Modal: tashqariga bosilganda yopilmaydi (ma’lumot yo‘qolmaydi)', await dialogOpen());
await key('Escape');
check(
  'Modal: Escape bilan yopiladi',
  await waitFor(`!document.querySelector('[role=dialog]')`, 2000),
);
await clickText('Mahsulot qo‘shish');
await waitFor(`!!document.querySelector('[role=dialog]')`);
await clickText('Yaratish');
check(
  'Mahsulot formasi: bo‘sh forma o‘zbekcha xatolar ko‘rsatadi',
  await waitFor(textOnPage('Nomini kiriting')),
);
await key('Escape');

// 2b. Tahrirlash formasi mavjud qiymatlar bilan ochiladi (guruh, birlik)
await go('/products');
await waitFor(`document.querySelectorAll('tbody tr').length > 0`);
await evaluate(`document.querySelector('tbody tr').click()`);
await waitFor(textOnPage('Asosiy ma’lumot'));
await clickText('Tahrirlash');
check(
  'Mahsulotni tahrirlash: guruh maydoni to‘ldirilgan holda ochiladi',
  await waitFor(
    `!!document.querySelector('#p-group') && !document.querySelector('#p-group').innerText.includes('Tanlang') && document.querySelector('#p-name').value.length > 0`,
  ),
);
await key('Escape');

// 3. Guruhni o'chirish: mahsuloti bor guruh — bloklanadi
await go('/product-groups');
await waitFor(`document.querySelectorAll('tbody tr').length > 0`);
await evaluate(`document.querySelector('tbody tr button[aria-label="O‘chirish"]').click()`);
check(
  'Guruhni o‘chirish: tasdiqlash oynasi va bloklash izohi',
  await waitFor(
    `!!document.querySelector('[role=alertdialog]') && document.body.innerText.includes('mahsulot bor')`,
  ),
);
await key('Escape');

// 4. POS: mahsulot qo'shish → mijozsiz rad → mijoz bilan sotuv
await go('/sales');
await waitFor(
  `[...document.querySelectorAll('button')].some((b) => b.innerText.includes('so‘m') && !b.disabled)`,
);
await evaluate(
  `[...document.querySelectorAll('button')].find((b) => b.innerText.includes('so‘m') && !b.disabled).click()`,
);
check(
  'POS: mahsulot savatga qo‘shiladi',
  await waitFor(`!document.body.innerText.includes('Savat bo‘sh')`),
);
await clickText('Savdoni tasdiqlash');
check('POS: mijoz ismisiz sotuv rad etiladi', await waitFor(textOnPage('Mijoz ismi majburiy')));
await typeInto('#pos-customer', 'Brauzer Test');
await clickText('Savdoni tasdiqlash');
check('POS: sotuv yakunlanadi (chek oynasi)', await waitFor(textOnPage('Sotuv yakunlandi'), 8000));
await clickText('Yangi sotuv', 'button');
check('POS: yangi sotuv uchun savat tozalanadi', await waitFor(textOnPage('Savat bo‘sh')));
// Shtrix-kod orqali
const barcode = await evaluate(
  `(async () => { const db = JSON.parse(localStorage.getItem('divine.mock-db.v1')); return db.products.find((p) => p.barcode && p.status === 'ACTIVE')?.barcode; })()`,
);
await typeInto('#pos-barcode', barcode);
await key('Enter');
check(
  'POS: shtrix-kod + Enter savatga qo‘shadi',
  await waitFor(`!document.body.innerText.includes('Savat bo‘sh')`),
);

// 5. Kirim: qoralama 200 → miqdor o'zgarsa darhol yangilanadi
const draftId = await evaluate(
  `JSON.parse(localStorage.getItem('divine.mock-db.v1')).incoming.find((d) => d.status === 'DRAFT')?.id`,
);
await go(`/incoming/${draftId}`);
check(
  'Kirim: qoralamaning ombori formada saqlanib ko‘rinadi (Radix Select regressiyasi)',
  await waitFor(
    `!!document.querySelector('#in-warehouse') && !document.querySelector('#in-warehouse').innerText.includes('Tanlang')`,
  ),
);
check(
  'Kirim: TZ misoli — jami 200 dona',
  await waitFor(
    `document.querySelector('[data-testid=incoming-total-quantity]')?.innerText.includes('200')`,
  ),
);
await typeInto('input[aria-label="Miqdor 1"]', '60');
check(
  'Kirim: miqdor o‘zgarsa jami darhol 210',
  await waitFor(
    `document.querySelector('[data-testid=incoming-total-quantity]')?.innerText.includes('210')`,
    2000,
  ),
);

// 5b. Mahsulot tanlash: qidiruv server-side (katalog 100+ bo'lsa ham) + klaviatura
const lastProduct = await evaluate(
  `(() => { const db = JSON.parse(localStorage.getItem('divine.mock-db.v1')); return db.products.filter((p) => p.status === 'ACTIVE' && p.barcode).sort((a, b) => b.name.localeCompare(a.name, 'uz'))[0]; })()`,
);
await go('/incoming/new');
await waitFor(`!!document.querySelector('#in-product-0')`);
await evaluate(`document.querySelector('#in-product-0').click()`);
await waitFor(`!!document.querySelector('[role=listbox] [role=option]')`);
await send('Input.insertText', { text: lastProduct.name });
await waitFor(
  `[...document.querySelectorAll('[role=option]')].length === 1 && document.querySelector('[role=option]').innerText.includes(${JSON.stringify(lastProduct.name)})`,
);
await key('Enter');
check(
  'Mahsulot tanlash: alifbo bo‘yicha oxirgi mahsulot qidiruv + Enter bilan tanlanadi',
  await waitFor(
    `document.querySelector('#in-product-0')?.innerText.includes(${JSON.stringify(lastProduct.name)})`,
  ),
);
await typeInto('input[aria-label="Shtrix-kod"]', lastProduct.barcode);
await key('Enter');
check(
  'Kirim: shtrix-kod mavjud qatordagi miqdorni oshiradi (server lookup)',
  await waitFor(`document.querySelector('input[aria-label="Miqdor 1"]')?.value === '1'`),
);
await typeInto('input[aria-label="Shtrix-kod"]', '0000000000000');
await key('Enter');
check('Kirim: noma’lum shtrix-kod xato xabarini beradi', await waitFor(textOnPage('topilmadi')));
await go('/sales?tab=history');
await waitFor(`!!document.querySelector('[aria-label="Barcha mahsulotlar"]')`);
await evaluate(`document.querySelector('[aria-label="Barcha mahsulotlar"]').click()`);
await waitFor(`!!document.querySelector('[role=listbox] [role=option]')`);
await send('Input.insertText', { text: lastProduct.name });
await waitFor(`document.querySelectorAll('[role=option]').length === 2`);
await key('ArrowDown');
await key('Enter');
check(
  'Sotuv tarixi: mahsulot filtri (qidiruv + ↓ + Enter) URL’ga yoziladi',
  await waitFor(`location.search.includes(${JSON.stringify(`productId=${lastProduct.id}`)})`),
);

// 6. Userlar: yaratish → 6 xonali parol bir marta
await go('/users');
await waitFor(`document.querySelectorAll('tbody tr').length > 0`);
await clickText('User qo‘shish');
await waitFor(`!!document.querySelector('#u-login')`);
check(
  'User formasi: parol maydoni yo‘q',
  await evaluate(`!document.querySelector('[role=dialog] input[type=password]')`),
);
await typeInto('#u-login', 'brauzer01');
await clickText('Yaratish');
check(
  'User: 6 xonali parol ko‘rsatiladi',
  await waitFor(
    `/\\b\\d{6}\\b/.test(document.querySelector('[role=dialog]')?.innerText ?? '') && document.body.innerText.includes('faqat bir marta')`,
  ),
);
await clickText('Saqladim, yopish');
check(
  'User: parol oynasi yopilgach parol qayta ko‘rinmaydi',
  await waitFor(
    `!document.querySelector('[role=dialog]') && !/Parol yaratildi/.test(document.body.innerText)`,
  ),
);

// 6b. AC-25 (Phase 14): ochiladigan qatlamlar (kalendar, ro'yxat, menyu, modal) ham o'zbekcha —
// sahifa skani (ui-qa.mjs) ularni ko'rmaydi. So'zlar — ui-qa.mjs dagi `EN` + kalendar hafta kunlari qisqartmalari.
const EN_WORDS =
  /\b(Loading|Save|Cancel|Delete|Remove|Search|Submit|Close|Next|Previous|Back|Edit|Select|Choose|No results|Rows per page|Page \d|of \d+|Error|Retry|Toggle|Open menu|Clear|Filter|Sort|Notifications|Today|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|June|July|August|September|October|November|December|Dismiss|Copy|Settings|Logout|Sign in|Password|Username|Required|Invalid|Su|Mo|Tu|We|Th|Fr|Sa)\b/;
const overlayEnglish = () =>
  evaluate(`(() => {
    const EN = ${EN_WORDS};
    const layers = [...document.querySelectorAll('[role=dialog], [role=alertdialog], [role=listbox], [role=menu], [data-slot=popover-content]')];
    if (layers.length === 0) return null;
    const texts = layers.flatMap((n) => [n.innerText, ...[...n.querySelectorAll('[aria-label],[placeholder],[title]')].map((e) => [e.getAttribute('aria-label'), e.getAttribute('placeholder'), e.getAttribute('title')].filter(Boolean).join(' '))]);
    return [...new Set(texts.map((t) => t.match(EN)?.[0]).filter(Boolean))];
  })()`);
// Radix Select va DropdownMenu pointerdown'da ochiladi — `el.click()` emas, haqiqiy sichqoncha hodisasi.
const pointerClick = async (selector) => {
  const at = await evaluate(
    `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.offsetParent !== null); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  if (!at) return false;
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, ...at, button: 'left', clickCount: 1 });
  }
  return true;
};
const layerIsUzbek = async (name, open) => {
  await open();
  await waitFor(
    `!!document.querySelector('[role=dialog], [role=alertdialog], [role=listbox], [role=menu], [data-slot=popover-content]')`,
    3000,
  );
  await sleep(300);
  const found = await overlayEnglish();
  check(
    `AC-25: ${name} — inglizcha matn yo‘q`,
    Array.isArray(found) && found.length === 0,
    found === null ? 'qatlam ochilmadi' : found.join(', '),
  );
  await key('Escape');
  await sleep(250);
};
await go('/reports');
await layerIsUzbek('sana oralig‘i (kalendar)', () =>
  pointerClick('main [data-slot=popover-trigger]'),
);
await go('/products');
await waitFor(`document.querySelectorAll('tbody tr').length > 0`);
await layerIsUzbek('filtr ro‘yxati (select)', () =>
  pointerClick('main [data-slot=select-trigger]'),
);
await layerIsUzbek('qator amallari menyusi', () =>
  pointerClick('tbody [data-slot=dropdown-menu-trigger]'),
);
await layerIsUzbek('mahsulot formasi (xatolar bilan)', async () => {
  await clickText('Mahsulot qo‘shish');
  await waitFor(`!!document.querySelector('[role=dialog]')`);
  await clickText('Yaratish');
  await waitFor(textOnPage('Nomini kiriting'));
});

// 7. Tungi rejim va sidebar yig'ish
await go('/');
await clickText('Tungi rejimga o‘tish');
check(
  'Tungi rejim yoqiladi',
  await waitFor(`document.documentElement.classList.contains('dark')`, 2000),
);
await clickText('Kunduzgi rejimga o‘tish');
await clickText('Yon panelni yig‘ish');
check(
  'Sidebar yig‘iladi (faqat ikonkalar)',
  await waitFor(`document.querySelector('aside')?.getBoundingClientRect().width < 80`, 2000),
);
await clickText('Yon panelni yoyish');

// 8. Mobil drawer
await viewport(390, 844);
await go('/');
await clickText('Menyuni ochish');
check(
  'Mobil: drawer ochiladi',
  await waitFor(`!!document.querySelector('[role=dialog] nav')`, 2000),
);
await evaluate(
  `[...document.querySelectorAll('[role=dialog] nav a')].find((a) => a.innerText.trim() === 'Kirim').click()`,
);
check(
  'Mobil: havola bosilsa sahifa almashadi va drawer yopiladi',
  await waitFor(
    `location.pathname === '/incoming' && !document.querySelector('[role=dialog]')`,
    3000,
  ),
);

// 9. Auth (mock): logout → login sahifasi, xato parol, USER menyusi, admin bilan qaytish
await viewport(1440, 900);
await go('/');
await evaluate(
  `[...document.querySelectorAll('aside button')].find((b) => b.getAttribute('aria-label') === 'Tizimdan chiqish').click()`,
);
check(
  'Auth: logout → login sahifasi',
  await waitFor(
    `location.pathname === '/login' && document.querySelector('h1')?.innerText === 'Tizimga kirish'`,
  ),
);
await go('/users');
check(
  'Auth: chiqilgandan keyin himoyalangan sahifa → /login?redirect',
  await waitFor(`location.pathname === '/login' && location.search === '?redirect=%2Fusers'`),
);
const submitLogin = async (login, password) => {
  await typeInto('#login-login', login);
  await typeInto('#login-password', password);
  await evaluate(`document.querySelector('form button[type=submit]').click()`);
};
await submitLogin('aziz', '000000');
check(
  'Auth: noto‘g‘ri parol → umumiy xato',
  await waitFor(
    `document.querySelector('[role=alert]')?.innerText.includes('Login yoki parol noto‘g‘ri')`,
  ),
);
await submitLogin('aziz', '123456');
check(
  'Auth: USER kirdi — admin bo‘limi URL bilan → "Ruxsat yo‘q"',
  await waitFor(
    `location.pathname === '/users' && document.querySelector('h1')?.innerText === 'Ruxsat yo‘q'`,
  ),
);
check(
  'Auth: USER menyusida faqat 4 ta bo‘lim (Xarajatlar — faqat qo‘shish, D-12)',
  await waitFor(`document.querySelectorAll('aside nav a').length === 4`),
);
await evaluate(
  `[...document.querySelectorAll('aside button')].find((b) => b.getAttribute('aria-label') === 'Tizimdan chiqish').click()`,
);
await waitFor(`location.pathname === '/login'`);
await submitLogin('admin', '123456');
check(
  'Auth: admin qayta kirdi — 11 ta bo‘lim',
  await waitFor(
    `location.pathname === '/' && document.querySelectorAll('aside nav a').length === 11`,
  ),
);

check('JS xatolari yo‘q', jsErrors.length === 0, jsErrors.join(' | '));
ws.close();
await stopChrome();
const failed = results.filter((r) => !r).length;
console.log(
  failed
    ? `\n${failed} ta ssenariy muvaffaqiyatsiz`
    : `\nBarcha ${results.length} ta ssenariy o‘tdi`,
);
process.exit(failed ? 1 : 0);
