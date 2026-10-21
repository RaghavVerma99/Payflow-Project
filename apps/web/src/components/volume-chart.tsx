import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TimeseriesPoint } from "../lib/api";
import {
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
  formatShortDate,
} from "../lib/utils";

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: TimeseriesPoint }>;
}

function ChartTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;

  return (
    <div className="min-w-44 rounded-xl border border-border bg-popover/95 px-3.5 py-3 text-xs shadow-2xl backdrop-blur-md">
      <p className="font-mono text-[8px] uppercase tracking-[0.18em] text-primary">
        {formatShortDate(point.date)}
      </p>
      <p className="display mt-1.5 text-xl">
        {formatCurrency(point.volume_minor)}
      </p>
      <div className="mt-2 space-y-1 border-t border-border/70 pt-2 text-[10px]">
        <div className="flex items-center justify-between gap-6">
          <span className="text-muted-foreground">Payments</span>
          <span className="tabular">{formatNumber(point.payments)}</span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="text-muted-foreground">Settled</span>
          <span className="tabular text-emerald-600 dark:text-emerald-300">
            {point.succeeded}
          </span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="text-muted-foreground">Failed</span>
          <span className="tabular text-rose-600 dark:text-rose-300">
            {point.failed}
          </span>
        </div>
      </div>
    </div>
  );
}

export function VolumeChart({ data }: { data: TimeseriesPoint[] }) {
  const hasData = data.some((point) => point.payments > 0);

  if (!hasData) {
    return (
      <div className="flex h-[268px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/80 bg-muted/10 text-center">
        <p className="display-soft text-lg">A quiet stretch of days.</p>
        <p className="text-[11px] text-muted-foreground">
          No payment volume in this window yet.
        </p>
      </div>
    );
  }

  const peak = data.reduce((best, point) =>
    point.volume_minor > best.volume_minor ? point : best,
  );

  return (
    <div className="h-[268px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 12, right: 8, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.38} />
              <stop offset="55%" stopColor="var(--chart-1)" stopOpacity={0.1} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={false}
            stroke="var(--border)"
            strokeDasharray="1 7"
          />
          <XAxis
            dataKey="date"
            tickFormatter={formatShortDate}
            tick={{
              fill: "var(--muted-foreground)",
              fontSize: 9,
              fontFamily: "JetBrains Mono Variable",
            }}
            tickLine={false}
            axisLine={false}
            minTickGap={30}
            dy={6}
          />
          <YAxis
            tickFormatter={(value: number) =>
              formatCompactCurrency(Number(value))
            }
            tick={{
              fill: "var(--muted-foreground)",
              fontSize: 9,
              fontFamily: "JetBrains Mono Variable",
            }}
            tickLine={false}
            axisLine={false}
            width={60}
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ stroke: "var(--primary)", strokeOpacity: 0.3 }}
          />
          <ReferenceLine
            x={peak.date}
            stroke="var(--primary)"
            strokeOpacity={0.18}
            strokeDasharray="2 5"
          />
          <Area
            type="monotone"
            dataKey="volume_minor"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#volumeFill)"
            activeDot={{
              r: 4,
              fill: "var(--background)",
              stroke: "var(--primary)",
              strokeWidth: 2,
            }}
            dot={false}
            animationDuration={900}
          />
          <ReferenceDot
            x={peak.date}
            y={peak.volume_minor}
            r={3}
            fill="var(--primary)"
            stroke="var(--background)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
