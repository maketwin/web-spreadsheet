/**
 * Records one experiment: a labelled measurement of wall-clock time, an
 * optional counter (events, calls) and the heap before/after.
 */
export interface Sample {
  readonly label: string;
  ms: number;
  count?: number | undefined;
  heapMbBefore?: number | undefined;
  heapMbAfter?: number | undefined;
}

export interface Recorder {
  /** Runs `fn`, records how long it took and returns what it returned. */
  time<T>(label: string, fn: () => T): T;
  readonly samples: Sample[];
}

const mb = (bytes: number): number => Math.round(bytes / 1e6);

function heapMb(): number | undefined {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc === undefined) return undefined;
  gc();
  gc();
  return mb(process.memoryUsage().heapUsed);
}

export function recorder(): Recorder {
  const samples: Sample[] = [];
  return {
    samples,
    time<T>(label: string, fn: () => T): T {
      const before = heapMb();
      const t0 = performance.now();
      const out = fn();
      const ms = performance.now() - t0;
      samples.push({ label, ms, heapMbBefore: before, heapMbAfter: heapMb() });
      return out;
    },
  };
}

/** Prints the recorded samples as one table and returns them for assertions. */
export function report(suite: string, rec: Recorder): Sample[] {
  const rows: Array<[string, string, string, string]> = rec.samples.map((s) => {
    const count = s.count === undefined ? '' : String(s.count);
    const heap = s.heapMbAfter === undefined ? '' : `${s.heapMbAfter} MB`;
    return [s.label, `${s.ms.toFixed(1)} ms`, count, heap];
  });
  const width = Math.max(12, ...rows.map((r) => r[0].length));
  console.log(`\n┌─ ${suite}`);
  for (const [label, ms, count, heap] of rows) {
    console.log(`│ ${label.padEnd(width)}  ${ms.padStart(12)}  ${count.padStart(12)}  ${heap.padStart(10)}`);
  }
  console.log('└─');
  return rec.samples;
}

/**
 * Cost guard for an experiment: `targetMs` is what we aim for; the test fails
 * only when the sample is ten times over, so a slow machine does not turn the
 * experiment red.
 */
export function within(sample: { label: string; ms: number }, targetMs: number): void {
  if (sample.ms <= targetMs * 10) return;
  throw new Error(`${sample.label}: ${sample.ms.toFixed(0)} ms is more than 10x the ${targetMs} ms target`);
}

/** Deterministic pseudo-random numbers so every run generates the same data. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
