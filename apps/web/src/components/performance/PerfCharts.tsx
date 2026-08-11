import type { PerfSnapshot, PerfStatusCount, PerfTimePoint } from "@api-lab/performance-engine";

/**
 * Charts are hand-rolled inline SVG rather than a charting library.
 *
 * CLAUDE.md requires a stated architectural reason for every new dependency,
 * and there isn't one here: these are four small, static, non-interactive
 * plots over at most 600 points. Recharts/Chart.js/D3 would each add a large
 * dependency (and, for D3, a second rendering model) to draw polylines and
 * rectangles that are a few dozen lines of SVG. Keeping it inline also keeps
 * the charts theme-aware through the same Tailwind classes as the rest of
 * the UI, with no separate palette to maintain.
 */

const CHART_WIDTH = 560;
const CHART_HEIGHT = 120;
const PADDING = { top: 8, right: 8, bottom: 18, left: 40 };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

interface LineChartProps {
  points: PerfTimePoint[];
  value: (point: PerfTimePoint) => number;
  label: string;
  unit: string;
  colorClass: string;
  testId: string;
}

function LineChart({ points, value, label, unit, colorClass, testId }: LineChartProps) {
  const innerWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const innerHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const maxY = niceMax(Math.max(...points.map(value), 0));
  const maxX = Math.max(points.length - 1, 1);

  const path = points
    .map((point, index) => {
      const x = PADDING.left + (index / maxX) * innerWidth;
      const y = PADDING.top + innerHeight - (value(point) / maxY) * innerHeight;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <figure className="min-w-0" data-testid={testId}>
      <figcaption className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </figcaption>
      {points.length === 0 ? (
        <p className="py-6 text-center text-xs text-neutral-400">No data yet.</p>
      ) : (
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="h-28 w-full"
          role="img"
          aria-label={`${label}: peak ${maxY} ${unit} over ${points.length} seconds`}
        >
          <line
            x1={PADDING.left}
            y1={PADDING.top + innerHeight}
            x2={CHART_WIDTH - PADDING.right}
            y2={PADDING.top + innerHeight}
            className="stroke-neutral-200 dark:stroke-neutral-700"
            strokeWidth="1"
          />
          <line
            x1={PADDING.left}
            y1={PADDING.top}
            x2={PADDING.left}
            y2={PADDING.top + innerHeight}
            className="stroke-neutral-200 dark:stroke-neutral-700"
            strokeWidth="1"
          />
          <text x="2" y={PADDING.top + 8} className="fill-neutral-400 text-[9px]">
            {maxY}
          </text>
          <text x="2" y={PADDING.top + innerHeight} className="fill-neutral-400 text-[9px]">
            0
          </text>
          <text x={PADDING.left} y={CHART_HEIGHT - 4} className="fill-neutral-400 text-[9px]">
            0s
          </text>
          <text x={CHART_WIDTH - PADDING.right - 18} y={CHART_HEIGHT - 4} className="fill-neutral-400 text-[9px]">
            {points[points.length - 1]!.second}s
          </text>
          <path d={path} fill="none" strokeWidth="1.5" className={colorClass} />
        </svg>
      )}
    </figure>
  );
}

function statusColorClass(status: number): string {
  if (status >= 500) return "fill-red-500";
  if (status >= 400) return "fill-amber-500";
  if (status >= 300) return "fill-blue-400";
  return "fill-green-500";
}

function StatusDistribution({ distribution }: { distribution: PerfStatusCount[] }) {
  const total = distribution.reduce((sum, entry) => sum + entry.count, 0);
  const max = Math.max(...distribution.map((entry) => entry.count), 1);

  return (
    <figure data-testid="perf-status-distribution">
      <figcaption className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Response codes
      </figcaption>
      {distribution.length === 0 ? (
        <p className="py-6 text-center text-xs text-neutral-400">No responses recorded.</p>
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {distribution.map((entry) => (
              <tr key={entry.status} data-testid={`perf-status-${entry.status}`}>
                <th scope="row" className="w-10 py-0.5 text-left font-mono font-medium">
                  {entry.status}
                </th>
                <td className="py-0.5 pr-2">
                  <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="h-2 w-full" aria-hidden="true">
                    <rect x="0" y="0" width={(entry.count / max) * 100} height="8" className={statusColorClass(entry.status)} />
                  </svg>
                </td>
                <td className="w-24 py-0.5 text-right font-mono tabular-nums text-neutral-500 dark:text-neutral-400">
                  {entry.count.toLocaleString()}
                  {total > 0 && ` (${((entry.count / total) * 100).toFixed(1)}%)`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}

function PercentileSummary({ snapshot }: { snapshot: PerfSnapshot }) {
  const entries: Array<[string, number]> = [
    ["Min", snapshot.latency.min],
    ["P50", snapshot.latency.p50],
    ["P90", snapshot.latency.p90],
    ["P95", snapshot.latency.p95],
    ["P99", snapshot.latency.p99],
    ["Max", snapshot.latency.max],
  ];
  const max = Math.max(...entries.map(([, v]) => v), 1);

  return (
    <figure data-testid="perf-percentile-summary">
      <figcaption className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Latency percentiles
      </figcaption>
      <table className="w-full text-xs">
        <tbody>
          {entries.map(([label, value]) => (
            <tr key={label}>
              <th scope="row" className="w-10 py-0.5 text-left font-medium">
                {label}
              </th>
              <td className="py-0.5 pr-2">
                <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="h-2 w-full" aria-hidden="true">
                  <rect x="0" y="0" width={(value / max) * 100} height="8" className="fill-blue-500" />
                </svg>
              </td>
              <td className="w-20 py-0.5 text-right font-mono tabular-nums text-neutral-500 dark:text-neutral-400">
                {Math.round(value)} ms
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function PerfCharts({ snapshot }: { snapshot: PerfSnapshot }) {
  const series = snapshot.timeSeries;
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <LineChart
        testId="perf-chart-rps"
        points={series}
        value={(p) => p.requests}
        label="Requests per second"
        unit="req/s"
        colorClass="stroke-blue-500"
      />
      <LineChart
        testId="perf-chart-latency"
        points={series}
        value={(p) => p.p95LatencyMs}
        label="P95 latency over time"
        unit="ms"
        colorClass="stroke-violet-500"
      />
      <LineChart
        testId="perf-chart-errors"
        points={series}
        value={(p) => (p.requests === 0 ? 0 : (p.errors / p.requests) * 100)}
        label="Error rate over time"
        unit="%"
        colorClass="stroke-red-500"
      />
      <PercentileSummary snapshot={snapshot} />
      <StatusDistribution distribution={snapshot.statusDistribution} />
    </div>
  );
}
