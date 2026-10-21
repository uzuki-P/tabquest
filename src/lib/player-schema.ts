import { z } from "zod"

/**
 * Validation for the player directory, shared by the admin form and the
 * server request handlers. Names are deliberately not unique; two different
 * "Bu Tari"s are allowed.
 */

export const playerCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  note: z.string().trim().max(500).optional(),
})
export type PlayerCreateInput = z.infer<typeof playerCreateSchema>

export const playerUpdateSchema = playerCreateSchema
export type PlayerUpdateInput = z.infer<typeof playerUpdateSchema>
