/** Minimal in-process counters and a latency histogram, rendered in Prometheus text format. */
const counters = new Map<string, number>();
const gauges = new Map<string, () => number>();
const BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const buckets = new Array(BUCKETS_MS.length + 1).fill(0) as number[];
let latencySum = 0;
let latencyCount = 0;

function series(name: string, labels?: Record<string, string>) {
  if (!labels) return name;
  const body = Object.entries(labels).map(([k, v]) => `${k}="${v.replace(/["\\\n]/g, '_')}"`).join(',');
  return `${name}{${body}}`;
}

export const metrics = {
  inc(name: string, labels?: Record<string, string>, by = 1) {
    const key = series(name, labels);
    counters.set(key, (counters.get(key) ?? 0) + by);
  },
  gauge(name: string, read: () => number) {
    gauges.set(name, read);
  },
  observeLatency(ms: number) {
    const i = BUCKETS_MS.findIndex((b) => ms <= b);
    buckets[i === -1 ? BUCKETS_MS.length : i] += 1;
    latencySum += ms;
    latencyCount += 1;
  },
  render(): string {
    const lines: string[] = [];
    for (const [k, v] of counters) lines.push(`${k} ${v}`);
    for (const [k, read] of gauges) lines.push(`${k} ${read()}`);
    let running = 0;
    BUCKETS_MS.forEach((b, i) => {
      running += buckets[i];
      lines.push(`http_request_duration_ms_bucket{le="${b}"} ${running}`);
    });
    lines.push(`http_request_duration_ms_bucket{le="+Inf"} ${latencyCount}`);
    lines.push(`http_request_duration_ms_sum ${latencySum}`);
    lines.push(`http_request_duration_ms_count ${latencyCount}`);
    return `${lines.join('\n')}\n`;
  },
};
