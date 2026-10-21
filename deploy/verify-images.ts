/** Check that every published Turso bill image exists in the upload directory. */
import { createClient } from "@libsql/client"
import { openSync, readSync, closeSync, statSync } from "node:fs"
import path from "node:path"
import { tursoReadonlyCredentials } from "../scripts/turso-readonly"

const keyPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/

export async function verifyImages(uploadDir: string) {
  const { url, authToken } = tursoReadonlyCredentials()

  const client = createClient({ url, authToken })
  try {
    const result = await client.execute(
      "SELECT public_id, image_object_key, image_byte_size FROM bills WHERE status = 'published'"
    )
    for (const row of result.rows) {
      const key = row.image_object_key
      if (typeof key !== "string" || !keyPattern.test(key)) {
        throw new Error(
          `Published bill ${row.public_id} has no valid image key.`
        )
      }
      const filename = path.join(uploadDir, key)
      let fd: number | undefined
      try {
        const size = statSync(filename).size
        if (
          row.image_byte_size != null &&
          size !== Number(row.image_byte_size)
        ) {
          throw new Error(
            `size mismatch: expected ${row.image_byte_size}, got ${size}`
          )
        }
        fd = openSync(filename, "r")
        const header = Buffer.alloc(12)
        if (
          readSync(fd, header, 0, header.length, 0) !== 12 ||
          header.toString("ascii", 0, 4) !== "RIFF" ||
          header.toString("ascii", 8, 12) !== "WEBP"
        ) {
          throw new Error("invalid WebP header")
        }
      } catch (error) {
        throw new Error(`Image ${key} for bill ${row.public_id}: ${error}`)
      } finally {
        if (fd !== undefined) closeSync(fd)
      }
    }
    console.log(`[publish] verified ${result.rows.length} published images`)
    return {
      count: result.rows.length,
      samplePublicId: result.rows[0]?.public_id as string | undefined,
    }
  } finally {
    client.close()
  }
}

if (import.meta.main) {
  await verifyImages(
    path.resolve(process.env.TABQUEST_UPLOAD_DIR ?? "./data/uploads")
  )
}
