import { allocateProportional } from "@/domain/split"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core"
import { CheckCircleIcon } from "@phosphor-icons/react"
import { useState } from "react"
import { createPortal } from "react-dom"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { PersonAvatar } from "@/components/person-avatar"
import { formatRupiah, parseAmountInput } from "@/domain/money"
import type { BillFormApi } from "@/components/bill-form-sections"
import { formItemUnits } from "@/lib/bill-form"
import type { AllocationMatrix, BillFormValue } from "@/lib/bill-form"

/**
 * Drag-and-drop allocation board ("who ordered what"). A Counter column
 * holds unassigned receipt units; each billPlayer gets a column that fills
 * like a mini basket. All state lives in the same AllocationMatrix the form
 * builds its structure from, so this stays a pure view over form state.
 */

function counterCardId(itemId: string): string {
  return `card:counter:${itemId}`
}
function personCardId(personId: string, itemId: string): string {
  return `card:${personId}:${itemId}`
}
const COUNTER_ID = "counter"
function columnId(personId: string): string {
  return `col:${personId}`
}

// Identity tints for board items. Gold and emerald are reserved for
// celebration and success, so they never appear here. The old rose/pink
// slots are the two brand tokens (primary, foreground) so those item
// identities re-tint with the brand instead of holding onto the old pink
// theme; ink stays legible on both card surfaces.
const ITEM_TINTS = [
  "bg-primary",
  "bg-sky-500",
  "bg-violet-500",
  "bg-teal-500",
  "bg-foreground",
  "bg-indigo-500",
]

function tintFor(keys: string[], palette: string[], id: string): string {
  const index = keys.indexOf(id)
  return palette[(index < 0 ? 0 : index) % palette.length]
}

interface BoardItem {
  key: string
  name: string
  variantNotes: string
  ordered: number
  costs: Map<string, number>
}

interface BoardPerson {
  key: string
  alias: string
}

function allocated(matrix: AllocationMatrix, itemId: string, personId: string) {
  const raw = matrix[`${itemId}::${personId}`] ?? ""
  const parsed = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : 0
  return Number.isSafeInteger(parsed) ? parsed : 0
}

function toBoardItems(
  value: BillFormValue,
  matrix: AllocationMatrix
): BoardItem[] {
  return value.items
    .map((item) => ({
      key: item.key,
      name: item.name,
      variantNotes: item.variantNotes,
      ordered: formItemUnits(item),
      costs: new Map<string, number>(),
      lineTotal:
        (/^\d+$/.test(item.quantity.trim())
          ? Number(item.quantity.trim())
          : 0) * (parseAmountInput(item.unitPrice) ?? 0),
    }))
    .filter((item) => item.ordered > 0)
    .map((item) => {
      const weights = value.billPlayers.map((p) => ({
        billPlayerId: p.key,
        weight: allocated(matrix, item.key, p.key),
      }))
      const assigned = weights.reduce((sum, p) => sum + p.weight, 0)
      const total = item.lineTotal
      if (
        Number.isSafeInteger(total) &&
        total >= 0 &&
        assigned <= item.ordered
      ) {
        // Keep unassigned units in the calculation so partial cards show their own cost.
        const shares = allocateProportional(total, [
          ...weights,
          { billPlayerId: "", weight: item.ordered - assigned },
        ])
        item.costs = new Map(
          shares.map((share) => [share.billPlayerId, share.amount])
        )
      }
      return item
    })
}

/** Receipt rows can share a name with different variants, so label with both. */
function itemLabel(item: BoardItem): string {
  return item.variantNotes ? `${item.name} (${item.variantNotes})` : item.name
}

/**
 * Variant text under the item name, wrapped to two lines. A tooltip carries
 * the full text so clamped variants stay readable.
 */
function ItemVariant({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="line-clamp-2 block cursor-help text-left leading-snug text-muted-foreground" />
        }
      >
        {text}
      </TooltipTrigger>
      <TooltipContent side="top">{text}</TooltipContent>
    </Tooltip>
  )
}

export function AllocationBoard({
  value,
  matrix,
  setMatrix,
  onContinue,
  continueLabel = "Continue",
}: {
  /** Live form values (pass via form.Subscribe). */
  value: BillFormValue
  matrix: AllocationMatrix
  setMatrix: (update: (current: AllocationMatrix) => AllocationMatrix) => void
  /** Shown in the board header, enabled only when fully assigned. */
  onContinue?: () => void
  continueLabel?: string
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor)
  )

  const items = toBoardItems(value, matrix)
  const people: BoardPerson[] = value.billPlayers.map((p) => ({
    key: p.key,
    alias: p.alias,
  }))

  const remaining = new Map<string, number>()
  let totalOrdered = 0
  let totalAssigned = 0
  for (const item of items) {
    let assigned = 0
    for (const person of people) {
      assigned += allocated(matrix, item.key, person.key)
    }
    remaining.set(item.key, item.ordered - assigned)
    totalOrdered += item.ordered
    totalAssigned += Math.min(assigned, item.ordered)
  }
  const fullyAssigned =
    people.length > 0 && items.length > 0 && totalAssigned === totalOrdered
  const progress =
    totalOrdered === 0
      ? 0
      : Math.min(100, Math.round((totalAssigned / totalOrdered) * 100))

  /** Capacity left for one person on an item, respecting the other columns. */
  function capacityFor(itemId: string, personId: string): number {
    const item = items.find((i) => i.key === itemId)
    if (!item) return 0
    let others = 0
    for (const person of people) {
      if (person.key === personId) continue
      others += allocated(matrix, itemId, person.key)
    }
    return Math.max(0, item.ordered - others)
  }

  function change(itemId: string, personId: string, delta: number) {
    const item = items.find((i) => i.key === itemId)
    if (!item) return
    const next = allocated(matrix, itemId, personId) + delta
    const clamped = Math.max(0, Math.min(capacityFor(itemId, personId), next))
    setMatrix((current) => ({
      ...current,
      [`${itemId}::${personId}`]: String(clamped),
    }))
  }

  /**
   * Moves one unit between two people as a single matrix update. Two chained
   * `change` calls would clamp the destination against the source's
   * not-yet-removed units, so the moved unit would never arrive.
   */
  function move(itemId: string, fromPerson: string, toPerson: string) {
    const item = items.find((i) => i.key === itemId)
    if (!item) return
    setMatrix((current) => {
      const from = allocated(current, itemId, fromPerson)
      if (from <= 0) return current
      const removed = {
        ...current,
        [`${itemId}::${fromPerson}`]: String(from - 1),
      }
      let others = 0
      for (const person of people) {
        if (person.key === toPerson) continue
        others += allocated(removed, itemId, person.key)
      }
      const capacity = Math.max(0, item.ordered - others)
      const to = allocated(current, itemId, toPerson)
      return {
        ...removed,
        [`${itemId}::${toPerson}`]: String(Math.min(capacity, to + 1)),
      }
    })
  }

  const [activeDragId, setActiveDragId] = useState<string | null>(null)

  function onDragStart(event: DragStartEvent) {
    setActiveDragId(String(event.active.id))
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveDragId(null)
    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : null
    if (overId === null || activeId === overId) return

    const counterMatch = /^card:counter:(.+)$/.exec(activeId)
    if (counterMatch && overId.startsWith("col:")) {
      change(counterMatch[1], overId.slice("col:".length), 1)
      return
    }
    const personMatch = /^card:([^:]+):(.+)$/.exec(activeId)
    if (personMatch) {
      const [, fromPerson, itemId] = personMatch
      if (overId === COUNTER_ID) {
        change(itemId, fromPerson, -1)
        return
      }
      if (overId.startsWith("col:") && overId !== columnId(fromPerson)) {
        move(itemId, fromPerson, overId.slice("col:".length))
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="grow">
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={totalAssigned}
            aria-valuemin={0}
            aria-valuemax={totalOrdered}
          >
            <div
              className={
                fullyAssigned
                  ? "h-full bg-success transition-all"
                  : "h-full bg-primary transition-all"
              }
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {totalAssigned} of {totalOrdered} units assigned
          </p>
        </div>
        {onContinue && (
          <Button disabled={!fullyAssigned} onClick={onContinue}>
            {continueLabel}
          </Button>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveDragId(null)}
      >
        <div className="space-y-3">
          <CounterColumn items={items} remaining={remaining} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {people.map((person) => (
              <PersonColumn
                key={person.key}
                person={person}
                items={items}
                matrix={matrix}
                change={change}
              />
            ))}
          </div>
        </div>
        {typeof document !== "undefined" &&
          createPortal(
            <DragOverlay>
              {activeDragId && (
                <DragPreview
                  activeId={activeDragId}
                  items={items}
                  remaining={remaining}
                />
              )}
            </DragOverlay>,
            document.body
          )}
      </DndContext>

      {people.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Add billPlayers first; the board needs a column per person.
        </p>
      )}
    </div>
  )
}

/** Subscribes the board to form values so drags see the current matrix. */
export function AllocationBoardSection({
  form,
  matrix,
  setMatrix,
  onContinue,
  continueLabel,
}: {
  form: BillFormApi
  matrix: AllocationMatrix
  setMatrix: (update: (current: AllocationMatrix) => AllocationMatrix) => void
  onContinue?: () => void
  continueLabel?: string
}) {
  return (
    <form.Subscribe selector={(state) => state.values}>
      {(value) => (
        <AllocationBoard
          value={value}
          matrix={matrix}
          setMatrix={setMatrix}
          onContinue={onContinue}
          continueLabel={continueLabel}
        />
      )}
    </form.Subscribe>
  )
}

/**
 * Floating copy that follows the pointer during a drag. The card that was
 * grabbed stays behind in its slot, dimmed by the isDragging opacity on
 * CounterCard/PersonCard, so the board keeps showing what is being moved.
 */
function DragPreview({
  activeId,
  items,
  remaining,
}: {
  activeId: string
  items: BoardItem[]
  remaining: Map<string, number>
}) {
  const itemKeys = items.map((i) => i.key)
  const counterMatch = /^card:counter:(.+)$/.exec(activeId)
  const personMatch = counterMatch ? null : /^card:([^:]+):(.+)$/.exec(activeId)
  const item = items.find(
    (i) => i.key === (counterMatch?.[1] ?? personMatch?.[2])
  )
  if (!item) return null

  return (
    <div className="flex cursor-grabbing items-center gap-2 rounded-md border bg-background p-2 shadow-lg">
      <span
        className={`size-2 shrink-0 rounded-full ${tintFor(itemKeys, ITEM_TINTS, item.key)}`}
      />
      <span className="max-w-48 min-w-0 text-xs">
        <span className="block truncate">{item.name}</span>
        {item.variantNotes && <ItemVariant text={item.variantNotes} />}
      </span>
      {counterMatch ? (
        <Badge variant="secondary" className="shrink-0">
          ×{remaining.get(item.key) ?? 0}
        </Badge>
      ) : (
        personMatch && (
          <span className="shrink-0 text-xs font-medium">
            {formatRupiah(item.costs.get(personMatch[1]) ?? 0)}
          </span>
        )
      )}
    </div>
  )
}

function CounterColumn({
  items,
  remaining,
}: {
  items: BoardItem[]
  remaining: Map<string, number>
}) {
  const { setNodeRef, isOver } = useDroppable({ id: COUNTER_ID })
  const itemKeys = items.map((i) => i.key)
  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border p-3 ${isOver ? "border-primary bg-primary/5" : ""}`}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Counter</h3>
        <span className="text-xs text-muted-foreground">unassigned</span>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {items.map((item) => {
          const left = remaining.get(item.key) ?? 0
          const exhausted = left <= 0
          return (
            <li key={item.key}>
              {exhausted ? (
                <div className="flex items-center gap-2 rounded-md border p-2 opacity-50">
                  <span
                    className={`size-2 shrink-0 rounded-full ${tintFor(itemKeys, ITEM_TINTS, item.key)}`}
                  />
                  <span className="max-w-48 min-w-0 text-xs">
                    <span className="block truncate">{item.name}</span>
                    {item.variantNotes && (
                      <ItemVariant text={item.variantNotes} />
                    )}
                  </span>
                  <CheckCircleIcon
                    className="size-3.5 shrink-0 text-success"
                    weight="bold"
                  />
                </div>
              ) : (
                <CounterCard item={item} left={left} itemKeys={itemKeys} />
              )}
            </li>
          )
        })}
        {items.length === 0 && (
          <li className="text-xs text-muted-foreground">No items yet.</li>
        )}
      </ul>
    </div>
  )
}

function CounterCard({
  item,
  left,
  itemKeys,
}: {
  item: BoardItem
  left: number
  itemKeys: string[]
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: counterCardId(item.key),
    disabled: left <= 0,
  })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      tabIndex={0}
      className={`flex touch-none items-center gap-2 rounded-md border bg-background p-2 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
        isDragging ? "opacity-40" : "cursor-grab active:cursor-grabbing"
      }`}
      aria-label={`${itemLabel(item)}, ${left} unassigned. Drag to a person, or use the steppers in their column.`}
    >
      <span
        className={`size-2 shrink-0 rounded-full ${tintFor(itemKeys, ITEM_TINTS, item.key)}`}
      />
      <span className="max-w-48 min-w-0 text-xs">
        <span className="block truncate">{item.name}</span>
        {item.variantNotes && <ItemVariant text={item.variantNotes} />}
      </span>
      <Badge variant="secondary" className="shrink-0">
        ×{left}
      </Badge>
    </div>
  )
}

function PersonColumn({
  person,
  items,
  matrix,
  change,
}: {
  person: BoardPerson
  items: BoardItem[]
  matrix: AllocationMatrix
  change: (itemId: string, personId: string, delta: number) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId(person.key) })
  const itemKeys = items.map((i) => i.key)
  const held = items
    .map((item) => ({ item, qty: allocated(matrix, item.key, person.key) }))
    .filter((entry) => entry.qty > 0)
  const total = held.reduce(
    (sum, entry) => sum + (entry.item.costs.get(person.key) ?? 0),
    0
  )
  const units = held.reduce((sum, entry) => sum + entry.qty, 0)
  const label = person.alias || "Unnamed"

  return (
    <div
      ref={setNodeRef}
      className={`max-h-[300px] overflow-y-auto rounded-lg border p-3 ${
        isOver ? "border-primary bg-primary/5" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <PersonAvatar name={label} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{formatRupiah(total)}</p>
        </div>
      </div>

      <div className="mt-3 flex min-h-24 flex-col gap-2 rounded-md border border-dashed p-2">
        {held.length === 0 && (
          <p className="m-auto text-center text-xs text-muted-foreground">
            Drop items here
          </p>
        )}
        {held.map(({ item, qty }) => (
          <PersonCard
            key={item.key}
            personId={person.key}
            label={label}
            item={item}
            qty={qty}
            change={change}
            itemKeys={itemKeys}
          />
        ))}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">{units} units</p>
    </div>
  )
}

function PersonCard({
  personId,
  label,
  item,
  qty,
  change,
  itemKeys,
}: {
  personId: string
  label: string
  item: BoardItem
  qty: number
  change: (itemId: string, personId: string, delta: number) => void
  itemKeys: string[]
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: personCardId(personId, item.key),
  })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      tabIndex={0}
      className={`rounded-md border bg-background p-2 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex cursor-grab touch-none items-center gap-2 active:cursor-grabbing">
        <span
          className={`size-2 shrink-0 rounded-full ${tintFor(itemKeys, ITEM_TINTS, item.key)}`}
        />
        <span className="min-w-0 grow text-xs">
          <span className="block truncate">{item.name}</span>
          {item.variantNotes && <ItemVariant text={item.variantNotes} />}
        </span>
        <span className="shrink-0 text-xs font-medium">
          {formatRupiah(item.costs.get(personId) ?? 0)}
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-end gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon-xs"
          aria-label={`Remove one ${itemLabel(item)} from ${label}`}
          onClick={(event) => {
            event.stopPropagation()
            change(item.key, personId, -1)
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          −
        </Button>
        <span className="min-w-6 text-center text-xs tabular-nums">{qty}</span>
        <Button
          type="button"
          variant="outline"
          size="icon-xs"
          aria-label={`Add one ${itemLabel(item)} to ${label}`}
          onClick={(event) => {
            event.stopPropagation()
            change(item.key, personId, 1)
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          +
        </Button>
      </div>
    </div>
  )
}
