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
// Jadvalda haqiqiy qatorlar: yuklanish skeleti (`data-slot=skeleton`) ham `tbody tr` — uni bosish hech narsa qilmaydi.
const tableReady = `document.querySelectorAll('tbody tr').length > 0 && !document.querySelector('tbody [data-slot=skeleton]')`;
const textOnPage = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`;
const clickText = (t, selector = 'button, a, [role=tab], [role=option], [role=menuitem]') =>
  evaluate(
    `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.offsetParent !== null && (e.innerText.trim() === ${JSON.stringify(t)} || e.getAttribute('aria-label') === ${JSON.stringify(t)})); if (!el) return false; el.click(); return true; })()`,
  );
// Tasdiqlash tugmasida jami summa ham yoziladi ("Savdoni tasdiqlash · 25 000 so'm") — boshlanishi bo'yicha.
const clickConfirmSale = () =>
  evaluate(
    `(() => { const el = [...document.querySelectorAll('button')].find((b) => b.offsetParent !== null && b.innerText.trim().startsWith('Savdoni tasdiqlash')); if (!el) return false; el.click(); return true; })()`,
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
await waitFor(tableReady);
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
await waitFor(tableReady);
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
await clickConfirmSale();
check('POS: mijoz ismisiz sotuv rad etiladi', await waitFor(textOnPage('Mijoz ismi majburiy')));
await typeInto('#pos-customer', 'Brauzer Test');
await clickConfirmSale();
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

// 5. Qoldiq qo'shish (sobiq "Kirim" bo'limi) — Mahsulotlar bo'limida
await go('/incoming/new');
check(
  'Kirim: alohida bo‘lim yo‘q — eski URL /products ga yo‘naltiriladi',
  await waitFor(`location.pathname === '/products'`),
);
await waitFor(tableReady);
await clickText('Mahsulot qo‘shish');
check(
  'Mahsulot qo‘shish: “Boshlang‘ich qoldiq” bo‘limi (ombor, miqdor, sana, izoh) shu oynada',
  await waitFor(
    `!!document.querySelector('#p-stock-warehouse') && !!document.querySelector('#p-stock-quantity') && !!document.querySelector('#p-stock-date') && document.querySelector('[role=dialog]').innerText.includes('Boshlang‘ich qoldiq')`,
  ),
);
check(
  'Mahsulot qo‘shish: kelgan narxi oynada bitta (dublikat maydon yo‘q)',
  await evaluate(`document.querySelectorAll('[role=dialog] input[id$=cost]').length === 1`),
);
await key('Escape');
await waitFor(`!document.querySelector('[role=dialog]')`);
const lastProduct = await evaluate(
  `(() => { const db = JSON.parse(localStorage.getItem('divine.mock-db.v1')); return db.products.filter((p) => p.status === 'ACTIVE' && p.barcode).sort((a, b) => b.name.localeCompare(a.name, 'uz'))[0]; })()`,
);
await evaluate(`document.querySelector('table tbody tr').click()`);
await waitFor(textOnPage('Qoldiq qo‘shish'));
await clickText('Qoldiq qo‘shish');
check(
  'Qoldiq qo‘shish: oyna ochiladi, kelgan narxi kartadan oldindan to‘ldirilgan',
  await waitFor(
    `!!document.querySelector('#sr-quantity') && document.querySelector('#sr-cost')?.value !== ''`,
  ),
);
await typeInto('#sr-quantity', '1.5');
await clickText('Qabul qilish');
check(
  'Qoldiq qo‘shish: DONA mahsulotga kasr miqdor — maydon ostida xato, hech narsa yozilmaydi',
  await waitFor(textOnPage('butun son')),
);
await key('Escape');
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
await waitFor(tableReady);
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
await waitFor(tableReady);
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

// 7. Mavzu: birinchi kirishda qora; Sozlamalardagi banner bilan kunduzgi rejimga va qaytib
await evaluate(`localStorage.removeItem('divine.theme')`);
await go('/');
check(
  'Birinchi kirishda qora mavzu (standart)',
  await waitFor(
    `document.documentElement.classList.contains('dark') && /^(rgb\\(0, 0, 0\\)|(ok)?(lab|lch)\\(0 )/.test(getComputedStyle(document.body).backgroundColor)`,
    2000,
  ),
);
await go('/settings');
await clickText('Kunduzgi rejimga o‘tish');
check(
  'Sozlamalar banneri: kunduzgi rejim yoqiladi va saqlanadi',
  await waitFor(
    `!document.documentElement.classList.contains('dark') && localStorage.getItem('divine.theme') === 'light' && document.querySelector('[role=switch]')?.getAttribute('aria-busy') === 'false'`,
    6000,
  ),
);
await clickText('Tungi rejimga o‘tish');
check(
  'Sozlamalar banneri: tungi rejimga qaytadi',
  await waitFor(
    `document.documentElement.classList.contains('dark') && document.querySelector('[role=switch]')?.getAttribute('aria-busy') === 'false'`,
    6000,
  ),
);
await go('/');
await clickText('Yon panelni yig‘ish');
check(
  'Sidebar yig‘iladi (faqat ikonkalar)',
  await waitFor(`document.querySelector('aside')?.getBoundingClientRect().width < 80`, 2000),
);
await clickText('Yon panelni yoyish');

// 8. Planshet: chapdan ochiladigan drawer
await viewport(820, 1180);
await go('/');
await clickText('Menyuni ochish');
check(
  'Planshet: drawer ochiladi',
  await waitFor(`!!document.querySelector('[role=dialog] nav')`, 2000),
);
await evaluate(
  `[...document.querySelectorAll('[role=dialog] nav a')].find((a) => a.innerText.trim() === 'Ombor').click()`,
);
check(
  'Planshet: havola bosilsa sahifa almashadi va drawer yopiladi',
  await waitFor(
    `location.pathname === '/warehouses' && !document.querySelector('[role=dialog]')`,
    3000,
  ),
);

// 8b. Telefon: pastki menyu (guruh → bo'limlari pastdan → sahifa). Panel `fixed` — offsetParent null,
// shuning uchun clickText emas, getClientRects.
await viewport(390, 844);
await go('/');
const bottomNav = `document.querySelector('nav[aria-label="Pastki menyu"]')`;
check(
  'Telefon: pastki menyu ekran pastida, 4 ta guruh + Sotuv; hamburger tugmasi yo‘q',
  await waitFor(
    `(() => { const n = ${bottomNav}; if (!n) return false; const r = n.getBoundingClientRect(); const tabs = [...n.querySelectorAll('button, a')].map((e) => e.innerText.trim()).join(); const burger = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Menyuni ochish'); return Math.abs(r.bottom - innerHeight) < 2 && tabs === 'Asosiy,Katalog,Sotuv,Operatsiyalar,Boshqaruv' && (!burger || burger.getClientRects().length === 0); })()`,
    3000,
  ),
);
await evaluate(
  `[...${bottomNav}.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Katalog').click()`,
);
check(
  'Telefon: guruh bosilsa bo‘limlari pastdan ochiladi',
  await waitFor(
    `(() => { const d = document.querySelector('[role=dialog]'); return !!d && Math.abs(d.getBoundingClientRect().bottom - innerHeight) < 2 && [...d.querySelectorAll('nav a')].map((a) => a.innerText.trim()).join() === 'Mahsulotlar,Mahsulot guruhlari,Ombor'; })()`,
    2000,
  ),
);
await evaluate(
  `[...document.querySelectorAll('[role=dialog] nav a')].find((a) => a.innerText.trim() === 'Ombor').click()`,
);
check(
  'Telefon: bo‘lim bosilsa sahifa almashadi, oyna yopiladi, guruh faol',
  await waitFor(
    `location.pathname === '/warehouses' && !document.querySelector('[role=dialog]') && [...${bottomNav}.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Katalog')?.getAttribute('aria-current') === 'page'`,
    3000,
  ),
);
// Ro'yxat yuklanib bo'lgach sahifa uzayadi — har urinishda qayta oxirigacha aylantiriladi.
check(
  'Telefon: sahifa oxiri pastki menyu ostida qolmaydi',
  await waitFor(
    `(() => { window.scrollTo(0, document.documentElement.scrollHeight); return !document.querySelector('main [aria-busy=true]') && document.querySelector('main > div').getBoundingClientRect().bottom <= ${bottomNav}.getBoundingClientRect().top; })()`,
    4000,
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
  'Auth: kirmagan holatda himoyalangan sahifa → avval /welcome?redirect',
  await waitFor(`location.pathname === '/welcome' && location.search === '?redirect=%2Fusers'`),
);
await evaluate(`document.querySelector('a[href="/login?redirect=%2Fusers"]').click()`);
check(
  'Auth: landing "Kirish" → /login?redirect (qaytish manzili saqlanadi)',
  await waitFor(`location.pathname === '/login' && location.search === '?redirect=%2Fusers'`),
);
await waitFor(`!!document.querySelector('#login-login')`);
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
  'Auth: admin qayta kirdi — 10 ta bo‘lim',
  await waitFor(
    `location.pathname === '/' && document.querySelectorAll('aside nav a').length === 10`,
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
