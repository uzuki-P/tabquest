/** Refuse production updates from worktrees or a local-database admin service. */
import { readFileSync, existsSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { verifyImages } from "./verify-images"
import { tursoReadonlyCredentials } from "../scripts/turso-readonly"

function git(...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim())
  return result.stdout.toString().trim()
}

const checkout = path.resolve(git("rev-parse", "--show-toplevel"))
const mainCheckout = path.dirname(
  path.resolve(git("rev-parse", "--path-format=absolute", "--git-common-dir"))
)
if (checkout !== mainCheckout || git("branch", "--show-current") !== "main") {
  throw new Error("update-prod only runs in the main checkout on branch main.")
}

const envFile = path.join(os.homedir(), ".config/tabquest/admin.env")
const sourceEnvFile = path.join(checkout, ".env.prod")
const unit = Bun.spawnSync(
  ["systemctl", "--user", "cat", "tabquest-admin.service"],
  { stdout: "pipe", stderr: "pipe" }
)
if (
  unit.exitCode !== 0 ||
  !unit.stdout
    .toString()
    .includes("EnvironmentFile=%h/.config/tabquest/admin.env")
) {
  throw new Error(`Admin service must load ${envFile} as its EnvironmentFile.`)
}
const workingDirectory = Bun.spawnSync(
  [
    "systemctl",
    "--user",
    "show",
    "tabquest-admin.service",
    "-p",
    "WorkingDirectory",
    "--value",
  ],
  { stdout: "pipe", stderr: "pipe" }
)
if (
  workingDirectory.exitCode !== 0 ||
  path.resolve(workingDirectory.stdout.toString().trim()) !== checkout
) {
  throw new Error(`Admin service must run from the main checkout: ${checkout}`)
}
if (!existsSync(sourceEnvFile)) {
  throw new Error(
    `Missing ${sourceEnvFile}. Copy .env.prod.example and fill it in.`
  )
}
if ((statSync(sourceEnvFile).mode & 0o077) !== 0) {
  throw new Error(`Production env source must be private: ${sourceEnvFile}`)
}
if (!existsSync(envFile)) throw new Error(`Missing admin env file: ${envFile}`)
if (!readFileSync(sourceEnvFile).equals(readFileSync(envFile))) {
  throw new Error(
    "Production env changed. Run just install-prod-env before update-prod."
  )
}
if ((statSync(envFile).mode & 0o077) !== 0) {
  throw new Error(`Non-private credential file: ${envFile}`)
}
const config = readFileSync(envFile, "utf8")
const value = (name: string) =>
  config
    .match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]
    ?.trim()
    .replace(/^['"]|['"]$/g, "")
if (!value("TABQUEST_DATABASE_URL")?.startsWith("libsql://")) {
  throw new Error("Admin service needs a Turso TABQUEST_DATABASE_URL.")
}
if (!value("TABQUEST_DATABASE_AUTH_TOKEN")) {
  throw new Error("Admin service needs a Turso write token.")
}
if (value("TABQUEST_DATABASE_URL") !== tursoReadonlyCredentials().url) {
  throw new Error(
    "Admin Turso URL and the read-only image-check URL must match."
  )
}
if (!existsSync(path.join(checkout, ".vercel/project.json"))) {
  throw new Error(
    "Main checkout is not linked to Vercel. Run vercel link there once."
  )
}
const localEnv = path.join(checkout, ".env")
if (existsSync(localEnv)) {
  const contents = readFileSync(localEnv, "utf8")
  if (
    /^(VISION_API_TOKEN|TABQUEST_TURSO_READONLY_TOKEN|TABQUEST_DATABASE_AUTH_TOKEN|TABQUEST_DATABASE_URL)=\S+/m.test(
      contents
    )
  ) {
    throw new Error(
      "Move credentials and database settings out of the main checkout .env before the Vercel build."
    )
  }
}
// The admin build compiles these into its links (src/lib/urls.ts); without
// them it would ship placeholder hostnames. Bun loads them from .env.local.
for (const name of [
  "VITE_TABQUEST_PUBLIC_ORIGIN",
  "VITE_TABQUEST_ADMIN_ORIGIN",
  "VITE_TABQUEST_PROJECT_ROOT",
]) {
  if (!process.env[name]) {
    throw new Error(`Set ${name} in the main checkout .env.local.`)
  }
}
await verifyImages(path.join(checkout, "data/uploads"))
console.log(
  "[update-prod] main checkout, Turso admin config, and images verified"
)
