/**
 * Keeps private names out of this public repository. Scans every tracked
 * file (text and binary) for built-in terms plus any listed one per line in
 * the ignored `.private-terms` file (# starts a comment). Terms match
 * case-insensitively on word boundaries.
 *
 * Usage: bun run scripts/private-terms.ts [--messages <rev-range>]
 */
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

// Base64 so this file does not trip its own check.
const BUILT_IN = ["a29wZGVz", "b25lY29yZQ=="].map((t) =>
  Buffer.from(t, "base64").toString("utf8")
)

export type Hit = { where: string; term: string }

function git(root: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim())
  return result.stdout.toString()
}

export function loadTerms(root: string): string[] {
  const file = path.join(root, ".private-terms")
  const extra = existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .map((line) => line.replace(/#.*/, "").trim())
        .filter(Boolean)
    : []
  return [...new Set([...BUILT_IN, ...extra].map((t) => t.toLowerCase()))]
}

export function matcher(terms: string[]) {
  if (!terms.length) return /(?!)/gu
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  return new RegExp(
    `(?<![\\p{L}\\p{N}])(${escaped.join("|")})(?![\\p{L}\\p{N}])`,
    "giu"
  )
}

function scan(where: string, text: string, pattern: RegExp, hits: Hit[]) {
  for (const match of text.matchAll(pattern)) {
    hits.push({ where, term: match[1].toLowerCase() })
  }
}

/** Binary bytes match short words by chance; check only long terms there. */
const MIN_BINARY_TERM = 6

/** Every tracked path and its content, checked against the private terms. */
export function findPrivateTerms(root: string): Hit[] {
  const terms = loadTerms(root)
  const pattern = matcher(terms)
  const binaryPattern = matcher(
    terms.filter((t) => t.length >= MIN_BINARY_TERM)
  )
  const hits: Hit[] = []
  for (const file of git(root, "ls-files", "-z").split("\0").filter(Boolean)) {
    scan(`path ${file}`, file, pattern, hits)
    const full = path.join(root, file)
    if (!existsSync(full)) continue
    const bytes = readFileSync(full)
    const binary = bytes.includes(0)
    scan(file, bytes.toString("latin1"), binary ? binaryPattern : pattern, hits)
  }
  return hits
}

/** Commit messages, author names, and emails in a revision range. */
export function findPrivateTermsInCommits(root: string, range: string): Hit[] {
  const pattern = matcher(loadTerms(root))
  const hits: Hit[] = []
  const log = git(root, "log", "--format=%H%x00%an <%ae>%x00%B%x01", range)
  for (const entry of log.split("\x01").filter((e) => e.trim())) {
    const [hash, ...rest] = entry.trim().split("\0")
    scan(`commit ${hash.slice(0, 7)}`, rest.join("\n"), pattern, hits)
  }
  return hits
}

if (import.meta.main) {
  const root = git(process.cwd(), "rev-parse", "--show-toplevel").trim()
  const index = process.argv.indexOf("--messages")
  const hits = [
    ...findPrivateTerms(root),
    ...(index !== -1 && process.argv[index + 1]
      ? findPrivateTermsInCommits(root, process.argv[index + 1])
      : []),
  ]
  for (const hit of hits) console.error(`${hit.where}: ${hit.term}`)
  if (hits.length) {
    console.error(`Private terms found in ${hits.length} place(s).`)
    process.exit(1)
  }
  console.log("No private terms in tracked files.")
}
