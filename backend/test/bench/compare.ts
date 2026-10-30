/* eslint-disable no-console -- CLI: taqqoslash jadvali konsolga chiqariladi */
import { basename } from 'node:path';
import { type BenchKind, listBenchResults, readBenchResult } from './support/results.js';

/*
 * Benchmark natijalarini solishtirish (TESTING §5):
 *   pnpm --filter @divine/backend bench:compare reports          — shu turdagi oxirgi ikki natija
 *   pnpm --filter @divine/backend bench:compare <eski.json> <yangi.json>
 * Har bir o'lchov (nom bo'yicha) va har bir raqamli ko'rsatkich: eski, yangi, farq (%). Muhit yoki
 * ma'lumot hajmi farq qilsa — ogohlantiriladi (raqamlarni to'g'ridan-to'g'ri solishtirib bo'lmaydi).
 */
const args = process.argv.slice(2);
let files: string[];
if (args.length === 2) {
  files = args;
} else {
  const kind = (args[0] ?? 'reports') as BenchKind;
  files = listBenchResults(kind).slice(-2);
  if (files.length < 2) {
    console.error(`"${kind}" uchun kamida ikkita natija fayli kerak (test/bench/results/).`);
    process.exit(1);
  }
}
const [before, after] = files.map(readBenchResult) as [
  ReturnType<typeof readBenchResult>,
  ReturnType<typeof readBenchResult>,
];

console.log(`Eski:  ${basename(files[0]!)}${before.source ? ` (${before.source})` : ''}`);
console.log(`Yangi: ${basename(files[1]!)}`);
for (const [label, result] of [
  ['Eski', before],
  ['Yangi', after],
] as const) {
  if (result.note) console.warn(`Izoh (${label}): ${result.note}`);
}
for (const section of ['environment', 'dataset'] as const) {
  const keys = new Set([...Object.keys(before[section]), ...Object.keys(after[section])]);
  const diff = [...keys].filter((k) => String(before[section][k]) !== String(after[section][k]));
  if (diff.length > 0) {
    console.warn(
      `Ogohlantirish — ${section} farq qiladi: ${diff
        .map((k) => `${k}: ${before[section][k] ?? '—'} → ${after[section][k] ?? '—'}`)
        .join('; ')}`,
    );
  }
}

const rows: Record<string, string | number>[] = [];
const previous = new Map(before.metrics.map((m) => [m.name, m]));
for (const metric of after.metrics) {
  const old = previous.get(metric.name);
  for (const [key, value] of Object.entries(metric)) {
    if (key === 'name' || typeof value !== 'number') continue;
    const was = old?.[key];
    rows.push({
      "O'lchov": metric.name,
      "Ko'rsatkich": key,
      Eski: typeof was === 'number' ? Math.round(was) : '—',
      Yangi: Math.round(value),
      'Farq, %': typeof was === 'number' && was > 0 ? Math.round(((value - was) / was) * 100) : '—',
    });
  }
}
console.table(rows);
