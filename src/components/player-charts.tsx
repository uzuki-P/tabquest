import { scaleBand, scaleLinear } from "d3"
import { useRef, useState } from "react"

import { formatRupiah } from "@/domain/money"
import { monthLabel, shortMonthLabel } from "@/lib/time"
import { cn } from "@/lib/utils"
import type { BoardMonthPoint } from "@/server/services/insights"

/**
 * Charts for the public players pages: the directory's per-row trend
 * sparkbars and the profile's monthly, merchant, and item charts. Rendering
 * is React SVG positioned with d3 scales; every chart shows a hover tooltip
 * and keeps a fixed pixel width inside a scroll container so narrow viewports
 * scroll instead of squashing the graph.
 */

interface ChartTip {
  /** Cursor position relative to the chart's positioning container. */
  x: number
  y: number
  /** Container width used to keep the bubble on the chart. */
  width: number
  heading: string
  body: string
}

function useChartTip() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [tip, setTip] = useState<ChartTip | null>(null)
  const show = (event: React.MouseEvent, heading: string, body: string) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setTip({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      width: rect.width,
      heading,
      body,
    })
  }
  const hide = () => setTip(null)
  return { containerRef, tip, show, hide }
}

function TipBubble({ tip }: { tip: ChartTip | null }) {
  if (!tip) return null
  const left = Math.min(Math.max(tip.x, 76), Math.max(tip.width - 76, 76))
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full border-2 border-arena-line bg-arena-ink px-2.5 py-1.5 text-center font-mono text-xs text-arena-paper shadow-lg"
      style={{ left, top: tip.y - 8 }}
    >
      <p className="font-medium">{tip.heading}</p>
      <p className="text-arena-paper-muted tabular-nums">{tip.body}</p>
    </div>
  )
}

function bills(count: number): string {
  return `${count} bill${count === 1 ? "" : "s"}`
}

/**
 * The profile's month-by-month column chart. The svg keeps a fixed pixel
 * width (one column per month) inside a horizontal scroll container, so
 * small screens scroll instead of wrapping or squashing the bars.
 */
export function MonthSpendChart({ monthly }: { monthly: BoardMonthPoint[] }) {
  const { containerRef, tip, show, hide } = useChartTip()
  const width = Math.max(monthly.length * 56, 240)
  const height = 190
  const margin = { top: 10, right: 10, bottom: 24, left: 10 }
  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom
  const max = Math.max(...monthly.map((point) => point.spend), 1)
  const x = scaleBand<string>()
    .domain(monthly.map((point) => point.monthKey))
    .range([0, innerWidth])
    .paddingInner(0.38)
    .paddingOuter(0.12)
  const y = scaleLinear<number>().domain([0, max]).range([0, innerHeight])

  return (
    <div ref={containerRef} className="relative" onMouseLeave={hide}>
      <TipBubble tip={tip} />
      <div className="overflow-x-auto">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Spend per month"
        >
          <g transform={`translate(${margin.left},${margin.top})`}>
            {monthly.map((point) => {
              const barWidth = x.bandwidth()
              const barX = x(point.monthKey) ?? 0
              const barHeight = y(point.spend)
              const heading = monthLabel(`${point.monthKey}-01`)
              const body =
                point.spend > 0
                  ? `${formatRupiah(point.spend)} · ${bills(point.orders)}`
                  : "No orders"
              const hover = (event: React.MouseEvent) =>
                show(event, heading, body)
              return (
                <g
                  key={point.monthKey}
                  onMouseEnter={hover}
                  onMouseMove={hover}
                  onMouseLeave={hide}
                >
                  <rect
                    x={barX}
                    y={0}
                    width={barWidth}
                    height={innerHeight}
                    className="fill-transparent"
                    style={{ pointerEvents: "all" }}
                  />
                  {point.spend > 0 && (
                    <rect
                      x={barX}
                      y={innerHeight - barHeight}
                      width={barWidth}
                      height={barHeight}
                      rx={0}
                      className="fill-primary"
                    />
                  )}
                  <text
                    x={barX + barWidth / 2}
                    y={innerHeight + 15}
                    textAnchor="middle"
                    className="fill-muted-foreground text-xs whitespace-nowrap"
                  >
                    {shortMonthLabel(point.monthKey)}
                  </text>
                </g>
              )
            })}
            <line
              x1={0}
              x2={innerWidth}
              y1={innerHeight}
              y2={innerHeight}
              className="stroke-arena-line"
            />
          </g>
        </svg>
      </div>
    </div>
  )
}

/** Tiny per-row trend bars for the directory table, tooltips included. */
export function MiniTrendBars({
  monthly,
}: {
  monthly: Array<{ monthKey: string; spend: number }>
}) {
  const { containerRef, tip, show, hide } = useChartTip()
  const max = Math.max(...monthly.map((point) => point.spend), 1)
  return (
    <div
      ref={containerRef}
      className="relative inline-flex"
      onMouseLeave={hide}
    >
      <TipBubble tip={tip} />
      <div className="flex h-6 items-end gap-px" aria-hidden>
        {monthly.map((point) => {
          const hover = (event: React.MouseEvent) =>
            show(
              event,
              monthLabel(`${point.monthKey}-01`),
              point.spend > 0 ? formatRupiah(point.spend) : "No orders"
            )
          return (
            <div
              key={point.monthKey}
              onMouseEnter={hover}
              onMouseMove={hover}
              onMouseLeave={hide}
              className={cn(
                "w-1.5",
                point.spend > 0 ? "bg-primary/70" : "bg-muted"
              )}
              style={{ height: `${Math.max(8, (point.spend / max) * 100)}%` }}
            />
          )
        })}
      </div>
    </div>
  )
}

/** Chart token classes, in the theme's chart order; cycles past five. */
const STACK_CLASSES = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
] as const

/** Legend swatch class matching the merchant stack bar's segments. */
export function merchantSegmentColor(index: number): string {
  return STACK_CLASSES[index % STACK_CLASSES.length]
}

/**
 * One stacked bar showing how the person's spend splits across merchants.
 * Segment widths are percentages of the total, so the bar always fits its
 * container; legends can slice the same data without a second scale.
 */
export function MerchantStackBar({
  segments,
}: {
  segments: Array<{ merchant: string; spend: number; orders: number }>
}) {
  const { containerRef, tip, show, hide } = useChartTip()
  const total = segments.reduce((sum, segment) => sum + segment.spend, 0) || 1
  return (
    <div ref={containerRef} className="relative" onMouseLeave={hide}>
      <TipBubble tip={tip} />
      <div
        className="flex h-3 overflow-hidden border-2 border-arena-line bg-card"
        aria-hidden
      >
        {segments.map((segment, index) => {
          const share = Math.round((segment.spend / total) * 100)
          const hover = (event: React.MouseEvent) =>
            show(
              event,
              segment.merchant,
              `${bills(segment.orders)} · ${formatRupiah(segment.spend)} (${share}%)`
            )
          return (
            <div
              key={segment.merchant}
              className={cn("h-full", merchantSegmentColor(index))}
              style={{
                width: `${(segment.spend / total) * 100}%`,
              }}
              onMouseEnter={hover}
              onMouseMove={hover}
              onMouseLeave={hide}
            />
          )
        })}
      </div>
    </div>
  )
}

/**
 * The usual-order chart: one horizontal bar per item, length by spend, so
 * the bars still differ when every favorite was ordered the same number of
 * times. Rows keep their labels on one line (truncate, never wrap) and the
 * tooltip adds each item's share of item spend.
 */
export function ItemSpendBars({
  items,
}: {
  items: Array<{ name: string; quantity: number; spend: number }>
}) {
  const { containerRef, tip, show, hide } = useChartTip()
  const max = Math.max(...items.map((item) => item.spend), 1)
  const totalSpend = items.reduce((sum, item) => sum + item.spend, 0) || 1
  const scale = scaleLinear<number>()
    .domain([0, max])
    .range([4, 100])
    .clamp(true)
  return (
    <div ref={containerRef} className="relative" onMouseLeave={hide}>
      <TipBubble tip={tip} />
      <ul className="space-y-3">
        {items.map((item) => {
          const share = Math.round((item.spend / totalSpend) * 100)
          const hover = (event: React.MouseEvent) =>
            show(
              event,
              item.name,
              `${item.quantity}× · ${formatRupiah(item.spend)} (${share}% of items)`
            )
          return (
            <li key={item.name}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{item.name}</span>
                <span className="shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">
                  {item.quantity}× · {formatRupiah(item.spend)}
                </span>
              </div>
              <div
                className="mt-1 h-2.5 overflow-hidden border-2 border-arena-line bg-card"
                aria-hidden
              >
                <div
                  className="h-full bg-primary"
                  style={{ width: `${scale(item.spend)}%` }}
                  onMouseEnter={hover}
                  onMouseMove={hover}
                  onMouseLeave={hide}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
