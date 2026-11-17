"use client";

import { motion } from "framer-motion";
import { CATEGORY_COLORS } from "@/shared/lib/finance-categories";

type Slice = { key: string; label: string; value: number; color: string };
type BarPoint = { label: string; income: number; expense: number };
type TrendPoint = { label: string; balance: number };

function formatCompact(n: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    notation: n >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 0,
  }).format(n);
}

export function DonutChart({
  slices,
  locale,
  centerLabel,
}: {
  slices: Slice[];
  locale: string;
  centerLabel: string;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const size = 200;
  const stroke = 28;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="relative flex items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="hsl(var(--edge))"
          strokeWidth={stroke}
        />
        {slices.map((slice, i) => {
          const len = (slice.value / total) * c;
          const dash = `${len} ${c - len}`;
          const el = (
            <motion.circle
              key={slice.key}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={slice.color}
              strokeWidth={stroke}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              initial={{ strokeDasharray: `0 ${c}` }}
              animate={{ strokeDasharray: dash }}
              transition={{ duration: 0.7, delay: i * 0.05, ease: "easeOut" }}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-xs text-muted">{centerLabel}</div>
        <div className="font-display text-xl tabular-nums">
          {formatCompact(total === 1 && slices.every((s) => s.value === 0) ? 0 : slices.reduce((s, x) => s + x.value, 0), locale)}
        </div>
      </div>
    </div>
  );
}

export function CashflowBars({
  points,
  locale,
}: {
  points: BarPoint[];
  locale: string;
}) {
  const max = Math.max(
    1,
    ...points.flatMap((p) => [p.income, p.expense]),
  );
  const h = 160;
  const gap = 10;
  const barW = 14;
  const groupW = barW * 2 + 6;
  const width = Math.max(points.length * (groupW + gap), 240);

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={h + 28} className="min-w-full">
        {points.map((p, i) => {
          const x = i * (groupW + gap) + 8;
          const ih = (p.income / max) * h;
          const eh = (p.expense / max) * h;
          return (
            <g key={p.label}>
              <motion.rect
                x={x}
                y={h - ih}
                width={barW}
                height={ih}
                rx={4}
                fill="#14b8a6"
                initial={{ height: 0, y: h }}
                animate={{ height: ih, y: h - ih }}
                transition={{ duration: 0.55, delay: i * 0.04 }}
              />
              <motion.rect
                x={x + barW + 6}
                y={h - eh}
                width={barW}
                height={eh}
                rx={4}
                fill="#f43f5e"
                initial={{ height: 0, y: h }}
                animate={{ height: eh, y: h - eh }}
                transition={{ duration: 0.55, delay: i * 0.04 + 0.05 }}
              />
              <text
                x={x + groupW / 2}
                y={h + 18}
                textAnchor="middle"
                className="fill-[hsl(var(--muted))]"
                fontSize={10}
              >
                {p.label}
              </text>
              <title>
                {p.label}: +{formatCompact(p.income, locale)} / -
                {formatCompact(p.expense, locale)}
              </title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function BalanceTrend({
  points,
  locale,
}: {
  points: TrendPoint[];
  locale: string;
}) {
  const w = 420;
  const h = 160;
  const pad = 12;
  if (points.length === 0) {
    return <div className="h-40 flex items-center justify-center text-sm text-muted">-</div>;
  }
  const vals = points.map((p) => p.balance);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 1);
  const span = max - min || 1;

  const coords = points.map((p, i) => {
    const x =
      pad + (i / Math.max(points.length - 1, 1)) * (w - pad * 2);
    const y = pad + (1 - (p.balance - min) / span) * (h - pad * 2);
    return { x, y, ...p };
  });

  const line = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${c.y}`)
    .join(" ");
  const area = `${line} L${coords[coords.length - 1].x},${h - pad} L${coords[0].x},${h - pad} Z`;
  const zeroY = pad + (1 - (0 - min) / span) * (h - pad * 2);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-40">
        <line
          x1={pad}
          x2={w - pad}
          y1={zeroY}
          y2={zeroY}
          stroke="hsl(var(--edge))"
          strokeDasharray="4 4"
        />
        <motion.path
          d={area}
          fill="url(#balGrad)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
        />
        <defs>
          <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity="0.35" />
            <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.path
          d={line}
          fill="none"
          stroke="hsl(var(--accent))"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        />
        {coords.map((c) => (
          <circle
            key={c.label}
            cx={c.x}
            cy={c.y}
            r={3.5}
            fill="hsl(var(--panel))"
            stroke="hsl(var(--accent))"
            strokeWidth={2}
          >
            <title>
              {c.label}: {formatCompact(c.balance, locale)}
            </title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

export function categoryColor(key: string) {
  return CATEGORY_COLORS[key] ?? "#94a3b8";
}
