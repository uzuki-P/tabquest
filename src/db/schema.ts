import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

/**
 * Money columns are integer rupiah. Dates are `YYYY-MM-DD` calendar dates in
 * the bill's timezone (Asia/Jakarta). Timestamps are UTC ISO-8601 strings.
 */

export const bills = sqliteTable(
  "bills",
  {
    /** Bun.randomUUIDv7(), sortable internal ID. */
    id: text("id").primaryKey(),
    /** crypto.randomUUID(), opaque public ID used in /b/{public-id} URLs. */
    publicId: text("public_id").notNull(),
    merchant: text("merchant").notNull(),
    title: text("title"),
    orderDate: text("order_date").notNull(),
    timezone: text("timezone").notNull().default("Asia/Jakarta"),
    currency: text("currency").notNull().default("IDR"),
    sourceSubtotal: integer("source_subtotal").notNull(),
    finalTotal: integer("final_total").notNull(),
    /** draft | published */
    status: text("status").notNull().default("draft"),
    imageObjectKey: text("image_object_key"),
    imageMediaType: text("image_media_type"),
    imageByteSize: integer("image_byte_size"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    publishedAt: text("published_at"),
    /** Set when the bill is archived; archive hides it from lists only. */
    archivedAt: text("archived_at"),
  },
  (t) => [
    index("bills_order_date_idx").on(t.orderDate),
    uniqueIndex("bills_public_id_uq").on(t.publicId),
  ]
)

/**
 * People the admin can pick again on the next order. The service refuses to
 * delete a player that bills still reference, so recorded history keeps its
 * links; the FK's set-null is a last-resort net, not the guard.
 */
export const players = sqliteTable(
  "players",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    phone: text("phone"),
    note: text("note"),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("players_name_idx").on(t.name)]
)

/** Precomputed public hover details. Rebuilt when published bill data changes. */
export const playerHoverSummaries = sqliteTable("player_hover_summaries", {
  playerId: text("player_id")
    .primaryKey()
    .references(() => players.id, { onDelete: "cascade" }),
  rank: integer("rank").notNull(),
  totalSpend: integer("total_spend").notNull(),
  totalTips: integer("total_tips").notNull(),
  orderCount: integer("order_count").notNull(),
  badgesJson: text("badges_json").notNull(),
})

export const billPlayers = sqliteTable(
  "bill_players",
  {
    id: text("id").primaryKey(),
    billId: text("bill_id")
      .notNull()
      .references(() => bills.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    sortOrder: integer("sort_order").notNull(),
    /** The directory player this row represents; null only on legacy rows. */
    playerId: text("player_id").references(() => players.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("bill_players_bill_idx").on(t.billId),
    index("bill_players_player_idx").on(t.playerId),
  ]
)

export const items = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(),
    billId: text("bill_id")
      .notNull()
      .references(() => bills.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    variantNotes: text("variant_notes"),
    quantity: integer("quantity").notNull(),
    unitPrice: integer("unit_price").notNull(),
    lineTotal: integer("line_total").notNull(),
    bundleSize: integer("bundle_size").notNull().default(1),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("items_bill_idx").on(t.billId)]
)

export const itemAllocations = sqliteTable(
  "item_allocations",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    billPlayerId: text("bill_player_id")
      .notNull()
      .references(() => billPlayers.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
  },
  (t) => [
    uniqueIndex("item_allocations_item_bill_player_uq").on(
      t.itemId,
      t.billPlayerId
    ),
    index("item_allocations_item_idx").on(t.itemId),
  ]
)

export const adjustments = sqliteTable(
  "adjustments",
  {
    id: text("id").primaryKey(),
    billId: text("bill_id")
      .notNull()
      .references(() => bills.id, { onDelete: "cascade" }),
    /** discount | delivery | service | tax | other */
    type: text("type").notNull(),
    label: text("label").notNull(),
    /** Signed: discounts negative, fees positive. */
    signedAmount: integer("signed_amount").notNull(),
    /**
     * Amount as printed on the source receipt when the net differs, e.g. a
     * delivery fee printed as Rp3.500 but waived to Rp0 by a voucher.
     * Display-only; the split math only ever reads signedAmount.
     */
    originalAmount: integer("original_amount"),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("adjustments_bill_idx").on(t.billId)]
)

export const adjustmentAllocations = sqliteTable(
  "adjustment_allocations",
  {
    id: text("id").primaryKey(),
    adjustmentId: text("adjustment_id")
      .notNull()
      .references(() => adjustments.id, { onDelete: "cascade" }),
    billPlayerId: text("bill_player_id")
      .notNull()
      .references(() => billPlayers.id, { onDelete: "cascade" }),
    signedAmount: integer("signed_amount").notNull(),
  },
  (t) => [
    uniqueIndex("adjustment_allocations_adj_bill_player_uq").on(
      t.adjustmentId,
      t.billPlayerId
    ),
  ]
)

export const paymentStatuses = sqliteTable("payment_statuses", {
  billPlayerId: text("bill_player_id")
    .primaryKey()
    .references(() => billPlayers.id, { onDelete: "cascade" }),
  /** unpaid | paid */
  status: text("status").notNull().default("unpaid"),
  /**
   * What the billPlayer actually handed over, as the admin recorded it.
   * Null until recorded; the split math never reads this. May sit above the
   * share (rounded up) or below it (came up short).
   */
  paidAmount: integer("paid_amount"),
  paidAt: text("paid_at"),
  lastChangedBy: text("last_changed_by"),
  updatedAt: text("updated_at").notNull(),
})

export const paymentEvents = sqliteTable(
  "payment_events",
  {
    id: text("id").primaryKey(),
    billPlayerId: text("bill_player_id")
      .notNull()
      .references(() => billPlayers.id, { onDelete: "cascade" }),
    previousState: text("previous_state").notNull(),
    newState: text("new_state").notNull(),
    actorIdentity: text("actor_identity").notNull(),
    eventTime: text("event_time").notNull(),
  },
  (t) => [index("payment_events_bill_player_idx").on(t.billPlayerId)]
)

export type BillRow = typeof bills.$inferSelect
export type PlayerRow = typeof players.$inferSelect
export type BillPlayerRow = typeof billPlayers.$inferSelect
export type ItemRow = typeof items.$inferSelect
export type ItemAllocationRow = typeof itemAllocations.$inferSelect
export type AdjustmentRow = typeof adjustments.$inferSelect
export type AdjustmentAllocationRow = typeof adjustmentAllocations.$inferSelect
export type PaymentStatusRow = typeof paymentStatuses.$inferSelect
export type PaymentEventRow = typeof paymentEvents.$inferSelect
