/**
 * Publishes the public site to Vercel.
 *
 * Copies the uploads directory (receipt images), runs the Vercel build,
 * copies the staged uploads into the serverless function directory (a
 * prebuilt deployment must ship every file it needs), and deploys. Bill
 * data is read live from Turso, so no database snapshot ships anymore;
 * the function picks up TABQUEST_DATABASE_URL and the read-only
 * TABQUEST_DATABASE_AUTH_TOKEN from the Vercel project's environment.
 *
 * Requires a one-time `vercel login` and `vercel link` in the repository.
 *
 * Usage: bun run deploy/publish.ts [--preview] [--stage-only]
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { pathToFileURL } from "node:url"
import path from "node:path"
import { verifyImages } from "./verify-images"

function arg(name: string, fallback: string): string {
  const prefix = `--${name}=`
  for (const item of process.argv.slice(2)) {
    if (item.startsWith(prefix)) return item.slice(prefix.length)
  }
  const index = process.argv.indexOf(`--${name}`)
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1]
  return fallback
}

const projectRoot = path.resolve(import.meta.dir, "..")
const uploadDir = path.resolve(
  process.cwd(),
  arg("uploads", process.env.TABQUEST_UPLOAD_DIR ?? "./data/uploads")
)
const stageDir = path.join(projectRoot, "deploy", "snapshot")
// The public production origin, for the post-deploy image check. Set
// VITE_TABQUEST_PUBLIC_ORIGIN in .env.local; the Vercel alias is the fallback.
const productionUrl =
  process.env.VITE_TABQUEST_PUBLIC_ORIGIN || "https://tabquest.vercel.app"
const preview = process.argv.includes("--preview")
const stageOnly = process.argv.includes("--stage-only")

function log(message: string) {
  console.log(`[publish] ${message}`)
}

function fail(message: string): never {
  console.error(`[publish] ${message}`)
  process.exit(1)
}

// The Vercel project must be linked so deploys land in the right place
// without interactive prompts.
if (
  !existsSync(path.join(projectRoot, ".vercel", "project.json")) &&
  !stageOnly
) {
  fail(
    "Project is not linked. Run `vercel login` and `vercel link` in the repository first."
  )
}

// 1. Copy the uploads (receipt images).
const images = await verifyImages(uploadDir)
const stagedUploads = path.join(stageDir, "uploads")
rmSync(stagedUploads, { recursive: true, force: true })
mkdirSync(stageDir, { recursive: true })
cpSync(uploadDir, stagedUploads, { recursive: true })
await verifyImages(stagedUploads)
log("staged uploads")

if (stageOnly) {
  log("stage-only: skipping build and deploy")
  process.exit(0)
}

// 2. Resolve the Vercel CLI: the devDependency's bin when installed, else
// whatever is on PATH.
function vercelCli(): string {
  const local = path.join(projectRoot, "node_modules", ".bin", "vercel")
  if (existsSync(local)) return local
  const onPath = Bun.which("vercel")
  if (onPath) return onPath
  fail("Vercel CLI not found. Run `bun add -d vercel` or install it globally.")
}

function run(command: string[], label: string) {
  log(label)
  const env = { ...process.env }
  for (const name of Object.keys(env)) {
    if (name.startsWith("TABQUEST_") || name.startsWith("VISION_API_")) {
      delete env[name]
    }
  }
  const proc = Bun.spawnSync(command, {
    cwd: projectRoot,
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const output = `${proc.stdout.toString()}${proc.stderr.toString()}`.trim()
  if (proc.exitCode !== 0) {
    fail(`${label} failed:\n${output}`)
  }
  return output
}

run(
  [
    vercelCli(),
    "pull",
    "--yes",
    `--environment=${preview ? "preview" : "production"}`,
  ],
  "pulling Vercel project settings"
)
run(
  [vercelCli(), "build", ...(preview ? [] : ["--prod"])],
  "building Vercel output"
)

// 3. Prebuilt deployments only upload what is inside .vercel/output, and
// the uploads path is env-provided at runtime, so dependency tracing
// cannot see it. Copy the stage into the function directory explicitly.
const config = JSON.parse(
  await Bun.file(path.join(projectRoot, ".vercel/output/config.json")).text()
) as { routes?: { dest?: string }[] }
const dest = config.routes?.find((route) =>
  route.dest?.endsWith("server")
)?.dest
if (!dest) fail("Could not find the server function in .vercel/output")
const funcDir = path.join(
  projectRoot,
  ".vercel",
  "output",
  "functions",
  `${dest.replace(/^\//, "")}.func`
)
if (!existsSync(funcDir)) fail(`Function directory missing: ${funcDir}`)

// Regression guard: nitro externalizes dependencies into _libs chunks, and
// whatever those chunks import must resolve where Vercel loads them. A bad
// specifier there means every request 500s at module load — this shipped
// once with a `node:ws` import that no Node runtime can resolve. Two
// checks: a parsed-import scan for untraced bare packages (precise names
// for the error), then the real thing — importing every chunk under Node,
// the same operation Vercel performs on cold start.
const libsDir = path.join(funcDir, "_libs")
if (existsSync(libsDir)) {
  const chunks = readdirSync(libsDir).filter((f) => f.endsWith(".mjs"))
  const transpiler = new Bun.Transpiler({ loader: "js" })
  const missing = new Set<string>()
  for (const chunk of chunks) {
    const source = await Bun.file(path.join(libsDir, chunk)).text()
    for (const imp of transpiler.scanImports(source)) {
      const spec = imp.path
      if (spec.startsWith(".") || spec.startsWith("node:")) continue
      const name = spec.startsWith("@")
        ? spec.split("/").slice(0, 2).join("/")
        : spec.split("/")[0]
      if (
        !existsSync(path.join(funcDir, "node_modules", name)) &&
        !existsSync(path.join(libsDir, "node_modules", name))
      ) {
        missing.add(`${name} (${chunk})`)
      }
    }
  }
  if (missing.size > 0) {
    fail(
      `Function bundle imports packages that are not traced into it: ` +
        `${[...missing].join(", ")}. Fix the nitro config in vite.config.ts.`
    )
  }
  const nodeOnPath = Bun.which("node")
  if (nodeOnPath) {
    const imports = chunks
      .map((f) => pathToFileURL(path.join(libsDir, f)).href)
      .map((href) => `await import(${JSON.stringify(href)});`)
      .join("\n")
    const probe = Bun.spawnSync(
      [
        nodeOnPath,
        "--input-type=module",
        "--eval",
        `try {\n${imports}\n} catch (error) {\n  console.error(error?.message ?? error);\n  process.exit(1);\n}`,
      ],
      { cwd: funcDir, stdout: "pipe", stderr: "pipe" }
    )
    if (probe.exitCode !== 0) {
      fail(
        `Node cannot load the function's lib chunks:\n` +
          probe.stderr.toString().trim()
      )
    }
    log(`lib chunks load under node (${chunks.length} chunks)`)
  } else {
    log("node not on PATH; skipped the chunk load probe")
  }
}

cpSync(stageDir, path.join(funcDir, "deploy", "snapshot"), { recursive: true })
await verifyImages(path.join(funcDir, "deploy", "snapshot", "uploads"))
log("copied staged uploads into the function bundle")

// 4. Deploy. The URL of the fresh deployment is the last https link printed.
const deployOutput = run(
  [vercelCli(), "deploy", "--prebuilt", ...(preview ? [] : ["--prod"])],
  preview ? "deploying preview" : "deploying production"
)
const urls = deployOutput.match(/https:\/\/[^\s]+/g)
if (!urls?.length) fail("Vercel did not return a deployment URL.")
const deployedUrl = urls[urls.length - 1]
log(`deployed: ${deployedUrl}`)
if (!preview && images.samplePublicId) {
  const imageUrl = new URL(
    `/api/public/bills/${images.samplePublicId}/image`,
    productionUrl
  )
  const response = await fetch(imageUrl, {
    signal: AbortSignal.timeout(15_000),
  })
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("image/webp")
  ) {
    fail(`Deployed image check failed: ${response.status} ${imageUrl}`)
  }
  log("deployed image responded with WebP")
}
log("done")
