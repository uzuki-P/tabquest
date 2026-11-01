import path from "node:path"
import { defineConfig, loadEnv } from "vite"
import type { Plugin } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import { nitro } from "nitro/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

/**
 * Server-function IDs encode `path#export` as base64url. The public runtime
 * gate decodes them and denies any function that belongs to an admin-only
 * source file, since RPC URLs do not carry the admin route path.
 */
function generateServerFnId({
  filename,
  functionName,
}: {
  filename: string
  functionName: string
}): string {
  const relative = path
    .relative(process.cwd(), filename)
    .split(path.sep)
    .join("/")
  return Buffer.from(`${relative}#${functionName}`, "utf8").toString(
    "base64url"
  )
}

/**
 * The tailnet hostnames the dev-router publishes for each dev runtime
 * (see the `dev:public` / `dev:admin` scripts and `just specific` routes).
 * Real hostnames come from the untracked .env.local.
 */
const DEV_ROUTES = {
  admin: {
    port: 46533,
    url:
      process.env.TABQUEST_DEV_ADMIN_URL ||
      "https://tabquest-dev.example.ts.net",
  },
  public: {
    port: 46534,
    url:
      process.env.TABQUEST_DEV_PUBLIC_URL ||
      "https://tabquest-dev-public.example.ts.net",
  },
} as const

/**
 * Public and admin origins are compiled into the client (src/lib/urls.ts).
 * A Vercel build without them would ship placeholder links, so refuse it.
 */
function requireDeployedOrigins(mode: string) {
  const env = loadEnv(mode, process.cwd(), "VITE_TABQUEST_")
  const missing = [
    "VITE_TABQUEST_PUBLIC_ORIGIN",
    "VITE_TABQUEST_ADMIN_ORIGIN",
  ].filter((name) => !env[name])
  if (missing.length) {
    throw new Error(
      `Set ${missing.join(" and ")} in .env.local or the Vercel project environment before building the public site.`
    )
  }
}

/**
 * Prints the published tailnet URL under Vite's localhost banner so the
 * running log shows both addresses. Only claims the URL when the server
 * actually binds the port the route points at.
 */
function devRouteLogger(): Plugin {
  const runtime = process.env.TABQUEST_RUNTIME === "public" ? "public" : "admin"
  const route = DEV_ROUTES[runtime]
  return {
    name: "tabquest-dev-route",
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        if (server.config.server.port !== route.port) return
        const printed = server.printUrls
        server.printUrls = () => {
          printed.call(server)
          server.config.logger.info(`  \u279c  Route:   ${route.url}`)
        }
      })
    },
  }
}

const config = defineConfig(({ command, mode }) => {
  // The Vercel target compiles the server through Nitro so Vercel deploys
  // the public runtime as a function. The default target keeps producing
  // the dist/client + dist/server layout that scripts/serve.ts runs, which
  // admin needs for its Bun-only image handling.
  const vercelTarget = process.env.TABQUEST_TARGET === "vercel"
  if (vercelTarget && command === "build") requireDeployedOrigins(mode)
  return {
    resolve: { tsconfigPaths: true },
    server: {
      // The dev servers sit behind the tailnet dev-router (publish-route),
      // so requests arrive with those hostnames instead of loopback.
      allowedHosts: [
        new URL(DEV_ROUTES.admin.url).hostname,
        new URL(DEV_ROUTES.public.url).hostname,
      ],
    },
    plugins: [
      devtools(),
      tailwindcss(),
      devRouteLogger(),
      tanstackStart({
        serverFns: { generateFunctionId: generateServerFnId },
        // Route tests live next to their route file; they are not routes.
        router: { routeFileIgnorePattern: "\\.test\\.tsx?$" },
        // Tailnet-only deployment with static meta tags, so every document
        // request serves the prerendered root shell and loaders run as RPCs
        // after hydration. The production server entry mirrors this with
        // TSS_SHELL (see scripts/serve.ts).
        spa: { enabled: true },
      }),
      ...(vercelTarget
        ? [
            nitro({
              preset: "vercel",
              // @libsql/isomorphic-ws resolves through package export
              // conditions: the node variant imports `ws`, which bun
              // treats as a builtin and externalizes as `node:ws` — a
              // specifier Node itself refuses, so the deployed function
              // 500s at module load. Pin the environment-agnostic variant
              // instead: it uses the global WebSocket that Node 24 (the
              // pinned function runtime) and Bun both provide.
              alias: {
                "@libsql/isomorphic-ws": path.resolve(
                  import.meta.dirname,
                  "node_modules/@libsql/isomorphic-ws/web.mjs"
                ),
              },
              vercel: {
                functions: {
                  // Nitro would otherwise pick the beta bun1.x runtime
                  // because the build runs under Bun; pin Node instead.
                  runtime: "nodejs24.x",
                  // The public runtime reads its uploads from an
                  // env-provided path, which dependency tracing cannot see,
                  // so the staged uploads are included by explicit glob.
                  // Prebuilt deploys must also copy these files into the
                  // function directory themselves (see deploy/publish.ts).
                  // The database lives on Turso: the url and the read-only
                  // token come from the Vercel project's environment
                  // variables (TABQUEST_DATABASE_URL,
                  // TABQUEST_DATABASE_AUTH_TOKEN).
                  includeFiles: "deploy/snapshot/uploads/**",
                  environment: {
                    // Mirrors the TSS_SHELL priming in scripts/serve.ts.
                    TSS_SHELL: "true",
                    // The public runtime denies admin routes itself.
                    TABQUEST_RUNTIME: "public",
                    TABQUEST_UPLOAD_DIR: "deploy/snapshot/uploads",
                  },
                },
              },
            }),
          ]
        : []),
      viteReact(),
    ],
  }
})

export default config
