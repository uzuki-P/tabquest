import { cn } from "@/lib/utils"

/**
 * Route-shaped loading skeletons in the two looks the app speaks. The
 * public pages play in the home board's arena language (square corners,
 * 2px ink borders, slab shadows, mono micro-labels), so their skeletons
 * mirror that silhouette; the admin pages keep the soft shadcn shapes and
 * their own primitives. Each skeleton mirrors the real page's layout (same
 * container width, header, and content structure) so a pending navigation
 * lands on the same silhouette instead of a generic box. Placeholder
 * chrome follows the real control sizes: the three-segment theme toggle is
 * roughly h-7 by 4.6rem wide, arena slab buttons are h-9.
 */

const THEME_TOGGLE = "h-7 w-[4.6rem]"

/* --- Soft primitives (admin pages) ---------------------------------- */

function Bar({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />
}

function BorderedBar({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md border border-border", className)}
    />
  )
}

function ThemeToggleBar() {
  return <Bar className={cn(THEME_TOGGLE, "rounded-md")} />
}

function CardSkeleton({
  className,
  children,
}: {
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div className={cn("rounded-xl border bg-card", className)}>{children}</div>
  )
}

function SrLoading({ label }: { label: string }) {
  return <span className="sr-only">{label}</span>
}

function FieldSkeleton({ labelWidth }: { labelWidth: string }) {
  return (
    <div className="space-y-1">
      <Bar className={cn("h-3", labelWidth)} />
      <Bar className="h-7 w-full rounded-md" />
    </div>
  )
}

/* --- Arena primitives (public pages) -------------------------------- */

/** Square soft block: interior detail lines inside arena frames. */
function ArenaBar({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse rounded-none bg-muted", className)} />
  )
}

/** Square outlined block: a control or framed region mid-load. */
function ArenaBox({
  className,
  children,
}: {
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-none border-2 border-arena-line bg-card",
        className
      )}
    >
      {children}
    </div>
  )
}

/** Square avatar placeholder; public avatars lose their round shape. */
function ArenaAvatar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "shrink-0 animate-pulse rounded-none border-2 border-arena-line bg-muted",
        className
      )}
    />
  )
}

/** One ink-ruled row of the home board's event feeds. */
function ArenaFeedRow() {
  return (
    <div className="flex items-center gap-3 border-b-2 border-arena-line px-3 py-3">
      <ArenaBar className="h-3 w-14" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <ArenaBar className="h-3.5 w-40" />
        <ArenaBar className="h-2.5 w-24" />
      </div>
      <ArenaBar className="h-4 w-16" />
      <ArenaBar className="h-3.5 w-20" />
    </div>
  )
}

/** Arena panel mid-load: title strip on the ink line, body below. */
function ArenaPanelSkeleton({
  titleWidth,
  children,
  className,
}: {
  titleWidth: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "border-2 border-arena-line bg-card shadow-[5px_5px_0_0_var(--arena-shadow)]",
        className
      )}
    >
      <div className="border-b-2 border-arena-line px-4 py-2">
        <ArenaBar className={cn("h-3", titleWidth)} />
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

/**
 * `/` — the arena board: month header with tallies, unpaid feed, player
 * card grid, tip jar band, week strip, and the events feed.
 */
export function HomeBoardSkeleton() {
  return (
    <div>
      <header className="sticky top-0 z-20 border-b-2 border-arena-line bg-card">
        <div className="mx-auto flex max-w-[1400px] flex-nowrap items-center gap-x-2.5 gap-y-3 px-4 py-3.5 sm:flex-wrap sm:gap-x-5 md:px-6">
          <ArenaBox className="size-9 sm:size-11" />
          <ArenaBox className="h-9 w-16 bg-primary/25 sm:h-11 sm:w-20" />
          <ArenaBox className="size-9 sm:size-11" />
          <ArenaBar className="h-7 w-28 min-w-0 flex-1 sm:h-8 sm:w-44 sm:flex-none" />
          <div className="ml-auto hidden items-center gap-4 sm:flex">
            <ArenaBar className="h-3 w-40" />
            <ArenaBar className="h-3 w-16" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-8 md:px-6">
        <section aria-label="Unpaid splits">
          <div className="flex items-center justify-between border-b-2 border-arena-line pb-2">
            <ArenaBar className="h-4 w-36" />
            <ArenaBar className="h-3 w-20" />
          </div>
          <div className="mt-2">
            <ArenaFeedRow />
            <ArenaFeedRow />
            <ArenaFeedRow />
          </div>
        </section>

        <section aria-label="Player cards" className="mt-10">
          <div className="flex items-center justify-between border-b-2 border-arena-line pb-2">
            <ArenaBar className="h-4 w-24" />
            <ArenaBar className="h-3 w-28" />
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="arena-deal border-2 border-arena-line bg-card shadow-[5px_5px_0_0_var(--arena-shadow)]"
                style={
                  {
                    "--anim-delay": `${Math.min(i * 0.07, 0.45)}s`,
                  } as React.CSSProperties
                }
              >
                <div className="flex items-center justify-between border-b-2 border-arena-line bg-primary/10 px-3 py-1.5">
                  <ArenaBar className="h-2.5 w-16 bg-primary/40" />
                  <ArenaBar className="h-2.5 w-12 bg-primary/40" />
                </div>
                <div className="p-3.5">
                  <div className="flex items-center gap-3">
                    <ArenaAvatar className="size-11" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <ArenaBar className="h-4 w-28" />
                      <ArenaBar className="h-2.5 w-36" />
                    </div>
                  </div>
                  <ArenaBar className="mt-3 h-7 w-32" />
                  <ArenaBox className="mt-1.5 h-3 w-full" />
                  <ArenaBar className="mt-2 h-2.5 w-24" />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section aria-label="Tip jar" className="mt-10">
          <div className="arena-rise border-2 border-arena-line bg-arena-ink p-5 shadow-[5px_5px_0_0_var(--primary)]">
            <ArenaBar className="h-3 w-20 bg-arena-paper-muted" />
            <ArenaBar className="mt-3 h-10 w-60 bg-arena-paper-muted" />
            <div className="mt-4 grid gap-3 border-t-2 border-arena-paper/20 pt-4 sm:grid-cols-3">
              {Array.from({ length: 3 }, (_, i) => (
                <ArenaBox
                  key={i}
                  className="h-32 border-arena-paper/25 bg-transparent"
                />
              ))}
            </div>
          </div>
        </section>

        <section aria-label="Week strip" className="mt-10">
          <div className="flex items-center justify-between border-b-2 border-arena-line pb-2">
            <ArenaBar className="h-4 w-40" />
            <ArenaBar className="h-3 w-44" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              <ArenaBox key={i} className="p-2.5">
                <ArenaBar className="h-2.5 w-12" />
                <ArenaBox className="mt-2 h-12" />
                <ArenaBar className="mt-2 h-2.5 w-16" />
              </ArenaBox>
            ))}
          </div>
        </section>

        <section aria-label="Recent events" className="mt-10 pb-6">
          <div className="flex items-center justify-between border-b-2 border-arena-line pb-2">
            <ArenaBar className="h-4 w-32" />
            <ArenaBar className="h-3 w-20" />
          </div>
          <div className="mt-2">
            <ArenaFeedRow />
            <ArenaFeedRow />
            <ArenaFeedRow />
            <ArenaFeedRow />
          </div>
        </section>
        <SrLoading label="Loading the board…" />
      </main>
    </div>
  )
}

/**
 * One public billPlayer card mid-load: rank strip, avatar row, big amount,
 * item lines, and the full-width copy button.
 */
export function PersonCardSkeleton() {
  return (
    <div className="arena-deal border-2 border-arena-line bg-card shadow-[5px_5px_0_0_var(--arena-shadow)]">
      <div className="flex items-center justify-between border-b-2 border-arena-line bg-primary/10 px-3 py-1.5">
        <ArenaBar className="h-2.5 w-10 bg-primary/40" />
        <ArenaBar className="h-2.5 w-16 bg-primary/40" />
      </div>
      <div className="p-3.5">
        <div className="flex items-center gap-3">
          <ArenaAvatar className="size-11" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <ArenaBar className="h-4 w-24" />
            <ArenaBar className="h-2.5 w-20" />
          </div>
        </div>
        <ArenaBar className="mt-3 h-7 w-28" />
        <div className="mt-3 space-y-1.5">
          <ArenaBar className="h-3 w-full" />
          <ArenaBar className="h-3 w-5/6" />
        </div>
        <ArenaBox className="mt-4 h-9 w-full" />
      </div>
    </div>
  )
}

/** `/b/$publicId` — header, total strip, splits grid, panel aside. */
export function PublicBillSkeleton() {
  return (
    <main className="container mx-auto max-w-7xl px-4 py-10 md:px-6">
      <ArenaBar className="h-2.5 w-36" />

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <ArenaBar className="h-7 w-48" />
          <ArenaBar className="h-3 w-40" />
        </div>
        <div className="flex items-center gap-2.5">
          <ArenaBox className="h-9 w-24" />
          <ArenaBox className="h-9 w-24 bg-primary/25" />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-3 border-b-2 border-arena-line pb-3">
        <ArenaBar className="h-3 w-28" />
        <ArenaBar className="h-9 w-48" />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <ArenaBox className="h-3 flex-1" />
        <ArenaBar className="h-3 w-24" />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section>
          <ArenaBox className="h-10 w-full" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <PersonCardSkeleton key={i} />
            ))}
          </div>
        </section>

        <aside className="space-y-6">
          <ArenaPanelSkeleton titleWidth="w-24">
            <ArenaBox className="h-44 w-full" />
          </ArenaPanelSkeleton>
          <ArenaPanelSkeleton titleWidth="w-32">
            <div className="space-y-2">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex justify-between gap-4">
                  <ArenaBar className="h-3.5 w-20" />
                  <ArenaBar className="h-3.5 w-16" />
                </div>
              ))}
              <div className="flex justify-between gap-4 border-t-2 border-arena-line pt-2">
                <ArenaBar className="h-4 w-16" />
                <ArenaBar className="h-4 w-20" />
              </div>
            </div>
          </ArenaPanelSkeleton>
        </aside>
      </div>
      <SrLoading label="Loading bill…" />
    </main>
  )
}

function TableSkeleton({ columns, rows }: { columns: number; rows: number }) {
  const width = (i: number) =>
    ["w-24", "w-40", "w-16", "w-20", "w-24", "w-16", "w-28"][i % 7]
  return (
    <div className="space-y-1">
      <div
        className="grid gap-4 border-b pb-2"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: columns }, (_, i) => (
          <Bar key={i} className={cn("h-3", width(i))} />
        ))}
      </div>
      {Array.from({ length: rows }, (_row, r) => (
        <div
          key={r}
          className="grid items-center gap-4 py-2.5"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }, (_, c) => (
            <Bar
              key={c}
              className={cn(
                "h-4",
                c === columns - 1 ? "ml-auto w-16" : width(c)
              )}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function PageHeaderSkeleton({
  subtitleWidth,
  withButton = true,
}: {
  subtitleWidth: string
  /** Admin pages show "New bill" next to the toggle; the players page does not. */
  withButton?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="space-y-2">
        <Bar className="h-6 w-32" />
        <Bar className={cn("h-4", subtitleWidth)} />
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggleBar />
        {withButton && <Bar className="h-7 w-16 rounded-md" />}
      </div>
    </div>
  )
}

/** `/admin` — header, filter tabs, and the bills table card. */
export function AdminBillsSkeleton() {
  return (
    <main className="container mx-auto max-w-4xl px-4 py-10">
      <PageHeaderSkeleton subtitleWidth="w-72" />
      <div className="mt-6 flex items-center gap-1">
        <Bar className="h-6 w-14 rounded-md" />
        <Bar className="h-6 w-16 rounded-md" />
        <Bar className="h-6 w-10 rounded-md" />
      </div>
      <CardSkeleton className="mt-4 p-6">
        <TableSkeleton columns={5} rows={7} />
      </CardSkeleton>
      <SrLoading label="Loading bills…" />
    </main>
  )
}

/** `/admin/players` — header, add-player row, and the directory table. */
export function AdminPlayersSkeleton() {
  return (
    <main className="container mx-auto max-w-5xl px-4 py-10">
      <PageHeaderSkeleton subtitleWidth="w-80" withButton={false} />
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Bar className="h-3 w-24" />
          <Bar className="h-7 w-64 rounded-md" />
        </div>
        <Bar className="h-7 w-12 rounded-md" />
        <div className="ml-2 flex items-center gap-2">
          <Bar className="size-4" />
          <Bar className="h-3 w-24" />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Bar className="h-6 w-16 rounded-md" />
          <Bar className="h-6 w-24 rounded-md" />
          <Bar className="h-6 w-24 rounded-md" />
        </div>
      </div>
      <CardSkeleton className="mt-4 p-6">
        <TableSkeleton columns={7} rows={6} />
      </CardSkeleton>
      <Bar className="mt-4 h-3 w-3/4" />
      <SrLoading label="Loading players…" />
    </main>
  )
}

/**
 * `/admin/bills/new` and `/admin/bills/$billId` — the wizard: header, step
 * pills, the current step's card, and the Back/Next footer.
 */
export function BillFormSkeleton() {
  return (
    <main className="container mx-auto max-w-5xl px-4 py-10">
      <PageHeaderSkeleton subtitleWidth="w-64" withButton={false} />
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Bar className="h-8 w-24 rounded-full bg-primary/15" />
        <Bar className="h-8 w-28 rounded-full" />
        <Bar className="h-8 w-20 rounded-full" />
        <Bar className="h-8 w-28 rounded-full" />
      </div>
      <CardSkeleton className="mt-6 p-6">
        <Bar className="h-4 w-28" />
        <Bar className="mt-2 h-3 w-56" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <FieldSkeleton key={i} labelWidth="w-20" />
          ))}
        </div>
        <div className="mt-6 border border-dashed p-4">
          <Bar className="h-24 w-full rounded-md" />
        </div>
      </CardSkeleton>
      <div className="mt-6 flex items-center justify-between">
        <BorderedBar className="h-7 w-14" />
        <Bar className="h-7 w-14 rounded-md" />
      </div>
      <SrLoading label="Loading bill editor…" />
    </main>
  )
}

/** `/tips` — ruled header, month chips, champion band, podium, field. */
export function TipsSkeleton() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 md:py-10">
      <div className="flex items-center justify-between gap-3 border-b-2 border-arena-line pb-2">
        <ArenaBar className="h-7 w-72" />
        <ArenaBar className="size-6 bg-primary/25" />
      </div>
      <div className="mt-2 space-y-1.5">
        <ArenaBar className="h-3 w-80" />
        <ArenaBar className="h-4 w-52 bg-primary/25" />
      </div>

      <div className="mt-5 flex gap-2">
        <ArenaBox className="h-7 w-24" />
        <ArenaBox className="h-7 w-28 bg-arena-ink" />
      </div>

      <div className="mt-6 border-2 border-arena-line bg-arena-ink p-5 shadow-[5px_5px_0_0_var(--gold)]">
        <ArenaBar className="h-3 w-40 bg-arena-paper-muted" />
        <div className="mt-4 flex items-center gap-4">
          <ArenaAvatar className="size-14 border-gold" />
          <div className="flex-1 space-y-2">
            <ArenaBar className="h-4 w-32 bg-arena-paper-muted" />
            <ArenaBar className="h-2.5 w-48 bg-arena-paper-muted" />
          </div>
          <ArenaBar className="h-8 w-24 bg-arena-paper-muted" />
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <ArenaBox className="h-[88px] shadow-[5px_5px_0_0_var(--arena-shadow)]" />
        <ArenaBox className="h-[88px] shadow-[5px_5px_0_0_var(--arena-shadow)]" />
      </div>

      <div className="mt-6 border-2 border-arena-line bg-card shadow-[5px_5px_0_0_var(--arena-shadow)]">
        <div className="flex items-center gap-2.5 border-b-2 border-arena-line px-4 py-2.5">
          <ArenaBar className="h-3 w-5" />
          <ArenaAvatar className="size-6" />
          <ArenaBar className="h-3.5 w-32" />
          <ArenaBar className="ml-auto h-3.5 w-16" />
        </div>
        <div className="flex items-center gap-2.5 px-4 py-2.5">
          <ArenaBar className="h-3 w-5" />
          <ArenaAvatar className="size-6" />
          <ArenaBar className="h-3.5 w-24" />
          <ArenaBar className="ml-auto h-3.5 w-14" />
        </div>
      </div>
      <SrLoading label="Loading the tip wall…" />
    </main>
  )
}

/** `/players` — arena podium tiles above the ink-ruled ledger table. */
export function PlayersSkeleton() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 md:px-6">
      <ArenaBar className="h-2.5 w-32" />
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-b-2 border-arena-line pb-3">
        <div className="space-y-2">
          <ArenaBar className="h-7 w-40" />
          <ArenaBar className="h-3 w-80" />
        </div>
        <ArenaBox className="h-9 w-64" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <ArenaBox
            key={i}
            className={cn(
              "flex flex-col items-center p-5 shadow-[5px_5px_0_0_var(--arena-shadow)]",
              i === 1 && "border-gold shadow-[5px_5px_0_0_var(--gold)]"
            )}
          >
            <ArenaAvatar className="size-14" />
            <ArenaBar className="mt-3 h-4 w-24" />
            <ArenaBar className="mt-2 h-6 w-28" />
            <ArenaBar className="mt-1.5 h-3 w-32" />
          </ArenaBox>
        ))}
      </div>

      <div className="mt-6 border-2 border-arena-line bg-card shadow-[5px_5px_0_0_var(--arena-shadow)]">
        <div className="grid grid-cols-8 gap-3 border-b-2 border-arena-line px-4 py-2.5">
          {Array.from({ length: 8 }, (_, i) => (
            <ArenaBar key={i} className="h-2.5" />
          ))}
        </div>
        {Array.from({ length: 6 }, (_, r) => (
          <div
            key={r}
            className="flex items-center gap-3 border-b-2 border-arena-line px-4 py-2.5 last:border-b-0"
          >
            <ArenaBar className="h-3 w-6" />
            <ArenaAvatar className="size-6" />
            <ArenaBar className="h-3.5 w-32" />
            <ArenaBar className="ml-auto h-3 w-10" />
            <ArenaBar className="h-3 w-16" />
            <ArenaBar className="h-3 w-16" />
            <ArenaBar className="h-3 w-12" />
            <div className="w-24 space-y-1">
              <ArenaBar className="ml-auto h-4 w-20" />
              <ArenaBox className="h-1.5 w-full" />
            </div>
          </div>
        ))}
      </div>
      <SrLoading label="Loading players…" />
    </main>
  )
}

/** `/players/$playerId` — centered arena profile over ruled sections. */
export function PlayerProfileSkeleton() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6">
      <ArenaBar className="h-2.5 w-44" />
      <div className="mt-6 flex flex-col items-center text-center">
        <ArenaAvatar className="size-16" />
        <ArenaBar className="mt-3 h-7 w-48" />
        <ArenaBar className="mt-2 h-5 w-40" />
        <ArenaBar className="mt-5 h-12 w-64" />
        <ArenaBar className="mt-3 h-3 w-72" />
      </div>
      {["w-32", "w-28", "w-36", "w-28"].map((heading, section) => (
        <div key={section} className="mt-10">
          <div className="flex items-center justify-between border-b-2 border-arena-line pb-2">
            <ArenaBar className={cn("h-4", heading)} />
            <ArenaBar className="h-3 w-16" />
          </div>
          <ArenaBox className="mt-4 h-36 w-full" />
        </div>
      ))}
      <SrLoading label="Loading profile…" />
    </main>
  )
}
