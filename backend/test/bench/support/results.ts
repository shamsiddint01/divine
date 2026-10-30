import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';

/*
 * Benchmark natijalari (TESTING §5): har ishga tushish `test/bench/results/<tur>-<vaqt>.json` ga
 * yoziladi — muhit, ma'lumot hajmi, o'lchov usuli va raqamlar bilan. `pnpm bench:compare` ikki
 * natijani (standart: shu turdagi eng oxirgi ikkitasi) solishtiradi.
 */
export const RESULTS_DIR = fileURLToPath(new URL('../results/', import.meta.url));

export type BenchKind = 'reports' | 'load';

/** Bitta o'lchov: `name` — barqaror kalit (taqqoslash shu bo'yicha), qiymatlar millisekundda. */
export interface BenchMetric {
  name: string;
  [metric: string]: string | number | undefined;
}

export interface BenchResult {
  kind: BenchKind;
  recordedAt: string;
  /** Natija qayerdan olingani (masalan, eski hujjatdan ko'chirilgan baseline). */
  source?: string;
  /** O'lchovdan keyin qo'shilgan izoh (masalan, bosqich yaroqsiz deb topilgani). Raqamlar o'zgarmaydi. */
  note?: string;
  environment: Record<string, string | number>;
  dataset: Record<string, string | number>;
  method: string;
  budget: Record<string, number>;
  metrics: BenchMetric[];
}

/** Mashina va DB muhiti — natijalar faqat o'xshash muhitda solishtiriladi. */
export function machineEnvironment(extra: Record<string, string | number> = {}) {
  const cpu = cpus();
  return {
    cpu: cpu[0]?.model ?? 'noma’lum',
    cores: cpu.length,
    ramGb: Math.round(totalmem() / 1024 ** 3),
    os: `${platform()} ${release()}`,
    node: process.version,
    ...extra,
  };
}

export function writeBenchResult(result: Omit<BenchResult, 'recordedAt'>): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const recordedAt = new Date().toISOString();
  const file = `${RESULTS_DIR}${result.kind}-${recordedAt.replace(/[:.]/g, '-')}.json`;
  writeFileSync(file, `${JSON.stringify({ ...result, recordedAt }, null, 2)}\n`);
  return file;
}

/** Shu turdagi natija fayllari, eskidan yangiga. */
export function listBenchResults(kind: BenchKind): string[] {
  return readdirSync(RESULTS_DIR)
    .filter((f) => f.startsWith(`${kind}-`) && f.endsWith('.json'))
    .sort()
    .map((f) => `${RESULTS_DIR}${f}`);
}

export const readBenchResult = (file: string): BenchResult =>
  JSON.parse(readFileSync(file, 'utf8')) as BenchResult;
