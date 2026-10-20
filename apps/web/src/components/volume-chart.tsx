import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TimeseriesPoint } from "../lib/api";
import {
  formatCompactCurrency,
  formatCurrency,
  formatShortDate,
  formatNumber,
} from "../lib/utils";

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: TimeseriesPoint }>;
}

function ChartTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;

  return (
    <div className="rounded-lg border border-border bg-popover/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <p className="mb-1.5 font-medium">{formatShortDate(point.date)}</p>
      <div className="space-y-1 text-[11px]">
        <div className="flex items-center justify-between gap-6">
          <span className="text-muted-foreground">Volume</span>
          <span className="tabular font-medium">
            {formatCurrency(point.volume_minor)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="text-muted-foreground">Payments</span>
          <span className="tabular">{formatNumber(point.payments)}</span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="text-muted-foreground">Settled / failed</span>
          <span className="tabular">
            {point.succeeded} / {point.failed}
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
      <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
        No payment volume in this window.
      </div>
    );
  }

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
              <stop
                offset="100%"
                stopColor="var(--chart-1)"
                stopOpacity={0.02}
              />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={false}
            stroke="var(--border)"
            strokeDasharray="3 3"
          />
          <XAxis
            dataKey="date"
            tickFormatter={formatShortDate}
            tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            minTickGap={28}
          />
          <YAxis
            tickFormatter={(value: number) =>
              formatCompactCurrency(Number(value))
            }
            tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={58}
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ stroke: "var(--border)" }}
          />
          <Area
            type="monotone"
            dataKey="volume_minor"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#volumeFill)"
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
