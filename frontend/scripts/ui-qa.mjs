#!/usr/bin/env node
// Divine.uz UI QA: real Chrome (headless) orqali barcha route'larni turli viewport va mavzularda tekshiradi.
//   node scripts/ui-qa.mjs [--base http://localhost:5180] [--sizes 1440,1280,1024,768,390] [--themes light,dark]
//                          [--shots ./qa-shots] [--routes /,/products]
// Tekshiradi: gorizontal overflow, JS xatolari / console.error, nomsiz tugmalar, label'siz input'lar.
// Haqiqiy backend (http rejim): QA_LOGIN=<login> QA_PASSWORD_FILE=<fayl> — avval UI orqali kiradi
// (parol fayldan o'qiladi, chiqarilmaydi). Refresh limiti 30/daq/IP: bitta ishga tushirishda 1–2 kenglik.
// Natija: har bir holat uchun bir qator; muammo bo'lsa exit code 1.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const BASE = arg('base', 'http://localhost:5180');
const SIZES = arg('sizes', '1440,1280,1024,768,390').split(',').map(Number);
const THEMES = arg('themes', 'light,dark').split(',');
const SHOTS = arg('shots', '');
const ROUTES = arg(
  'routes',
  '/,/users,/products,/product-groups,/warehouses,/sales,/sales?tab=history,/customers,/incoming,/incoming/new,/expenses,/reports,/settings,/settings?tab=audit,/nomalum-sahifa,/customers/yoq-id,/incoming/yoq-id',
).split(',');
const WAIT = Number(arg('wait', '2500'));
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'divine-qa-'));
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
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

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
const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  } else if (m.method === 'Runtime.exceptionThrown') {
    errors.push(
      m.params.exceptionDetails.exception?.description?.split('\n')[0] ??
        m.params.exceptionDetails.text,
    );
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push(
      m.params.args
        .map((a) => a.value ?? a.description ?? '')
        .join(' ')
        .slice(0, 200),
    );
  }
};
// Javobsiz qolgan CDP so'rovi (sahifa qotib qolsa) skriptni cheksiz kutishga qo'ymasin: aniq xato bilan to'xtaydi.
const SEND_TIMEOUT_MS = 30_000;
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(
        new Error(
          `CDP ${method} ${SEND_TIMEOUT_MS / 1000} s ichida javob bermadi (sahifa qotib qoldi)`,
        ),
      );
    }, SEND_TIMEOUT_MS);
    pending.set(id, (m) => {
      clearTimeout(timer);
      resolve(m);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
await send('Runtime.enable');
await send('Page.enable');

if (process.env.QA_LOGIN && process.env.QA_PASSWORD_FILE) {
  // Parol 6 xonali (BR-04): fayldagi birinchi shunday qiymat.
  const password = readFileSync(process.env.QA_PASSWORD_FILE, 'utf8').match(/\b\d{6}\b/)?.[0];
  if (!password) throw new Error('QA_PASSWORD_FILE ichida 6 xonali parol topilmadi');
  await send('Page.navigate', { url: BASE + '/login' });
  await sleep(2500);
  for (const [id, value] of [
    ['login-login', process.env.QA_LOGIN],
    ['login-password', password],
  ]) {
    await send('Runtime.evaluate', { expression: `document.getElementById('${id}').focus()` });
    await send('Input.insertText', { text: value });
  }
  await send('Runtime.evaluate', {
    expression: `document.querySelector('form button[type=submit]').click()`,
  });
  await sleep(2500);
  const at = (
    await send('Runtime.evaluate', { expression: 'location.pathname', returnByValue: true })
  ).result.result.value;
  if (at === '/login') throw new Error('QA: tizimga kirib bo‘lmadi');
}

const PROBE = `(() => {
  const vw = document.documentElement.clientWidth;
  const overflow = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    let p = el.parentElement, clipped = false;
    while (p) { if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) { clipped = true; break; } p = p.parentElement; }
    if (!clipped && r.right > vw + 1) overflow.push(el.tagName.toLowerCase() + '.' + String(el.className).split(' ').slice(0, 4).join('.') + ' →' + Math.round(r.right));
  }
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[aria-hidden=true]'); };
  const nameOf = (el) => (el.getAttribute('aria-label') || (el.closest('label')?.textContent) || el.textContent || el.getAttribute('title') || (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent) || '').trim();
  const unnamedButtons = [...document.querySelectorAll('button, [role=button], a[href]')].filter(visible).filter((b) => !nameOf(b)).map((b) => b.outerHTML.slice(0, 120));
  const unlabeledInputs = [...document.querySelectorAll('input:not([type=hidden]), textarea, select')].filter(visible).filter((i) => {
    if (i.getAttribute('aria-label') || i.getAttribute('aria-labelledby') || i.closest('label')) return false;
    return !(i.id && document.querySelector('label[for="' + CSS.escape(i.id) + '"]'));
  }).map((i) => i.outerHTML.slice(0, 120));
  // Desktop'da (>=1024px) jadval ichki gorizontal scroll'ga tushmasligi kerak (ustunlar sig'ishi shart).
  const tableScroll = vw >= 1024 ? [...document.querySelectorAll('[data-slot=table-container]')].filter((c) => visible(c) && c.scrollWidth > c.clientWidth + 1).map((c) => 'jadval ' + c.scrollWidth + '>' + c.clientWidth) : [];
  // AC-25 (Phase 14): ko'rinadigan matn va ekran o'quvchi atributlarida inglizcha UI so'zlari bo'lmasin
  // (kutubxonalarning standart matnlari ham: "Close", "Next", "Loading" ...).
  const EN = /\\b(Loading|Save|Cancel|Delete|Remove|Search|Submit|Close|Next|Previous|Back|Edit|Select|Choose|No results|Rows per page|Page \\d|of \\d+|Error|Retry|Toggle|Open menu|Clear|Filter|Sort|Notifications|Today|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|June|July|August|September|October|November|December|Dismiss|Copy|Settings|Logout|Sign in|Password|Username|Required|Invalid)\\b/;
  const english = [document.body.innerText, ...[...document.querySelectorAll('[aria-label],[placeholder],[title]')].filter(visible).map((el) => [el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('title')].filter(Boolean).join(' '))]
    .map((text) => text.match(EN)?.[0]).filter(Boolean);
  return { english: [...new Set(english)].slice(0, 5), tableScroll, scrollW: document.documentElement.scrollWidth, vw, overflow: overflow.slice(0, 5), unnamedButtons: unnamedButtons.slice(0, 5), unlabeledInputs: unlabeledInputs.slice(0, 5), h1: document.querySelector('h1')?.textContent ?? null };
})()`;

let problems = 0;
for (const theme of THEMES) {
  await send('Page.navigate', { url: BASE + '/' });
  await sleep(1500);
  await send('Runtime.evaluate', {
    expression: `localStorage.setItem('divine.theme', '${theme}')`,
  });
  for (const width of SIZES) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height: width < 600 ? 844 : 900,
      deviceScaleFactor: 1,
      mobile: width < 600,
    });
    for (const route of ROUTES) {
      errors.length = 0;
      await send('Page.navigate', { url: BASE + route });
      // Sahifa tayyor bo'lguncha (h1 chiqdi) kutish — qat'iy pauza yuklangan mashinada yetmaydi
      // (sessiya tiklanishi + lazy chunk). So'ng layout barqarorlashishi uchun qisqa pauza.
      for (let waited = 0; waited < WAIT * 5; waited += 250) {
        const ready = (
          await send('Runtime.evaluate', {
            expression: `!!document.querySelector('h1') && !document.querySelector('[role=status][aria-live]')`,
            returnByValue: true,
          })
        ).result.result?.value;
        if (ready) break;
        await sleep(250);
      }
      await sleep(Math.min(WAIT, 800));
      const res = (await send('Runtime.evaluate', { expression: PROBE, returnByValue: true }))
        .result.result.value;
      const bad =
        res.overflow.length ||
        res.tableScroll.length ||
        res.unnamedButtons.length ||
        res.unlabeledInputs.length ||
        res.english.length ||
        errors.length ||
        !res.h1;
      if (bad) problems++;
      console.log(
        `${bad ? '✗' : '✓'} ${theme.padEnd(5)} ${String(width).padStart(4)} ${route.padEnd(22)} h1=${JSON.stringify(res.h1)}` +
          (res.overflow.length ? `\n    overflow: ${res.overflow.join(' | ')}` : '') +
          (res.tableScroll.length ? `\n    ${res.tableScroll.join(' | ')}` : '') +
          (res.unnamedButtons.length
            ? `\n    nomsiz tugma: ${res.unnamedButtons.join(' | ')}`
            : '') +
          (res.unlabeledInputs.length
            ? `\n    label'siz input: ${res.unlabeledInputs.join(' | ')}`
            : '') +
          (res.english.length ? `\n    inglizcha matn: ${res.english.join(' | ')}` : '') +
          (errors.length ? `\n    xato: ${[...new Set(errors)].join(' | ')}` : ''),
      );
      if (SHOTS) {
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        const file = `${theme}-${width}-${route.replace(/[^a-z0-9]+/gi, '_') || 'root'}.png`;
        writeFileSync(join(SHOTS, file), Buffer.from(shot.result.data, 'base64'));
      }
    }
  }
}
ws.close();
await stopChrome();
console.log(problems ? `\n${problems} ta holatda muammo` : '\nMuammo topilmadi');
process.exit(problems ? 1 : 0);
