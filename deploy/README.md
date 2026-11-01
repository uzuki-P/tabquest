# Deploying Tabquest

## Current workflow

Development uses a separate SQLite copy in each Git worktree. Copy
`.env.example` to that worktree's ignored `.env.local`, then set the Turso
URL and a **read-only** token there:

```dotenv
TABQUEST_TURSO_URL=libsql://<db>-<org>.turso.io
TABQUEST_TURSO_READONLY_TOKEN=<read-only token>
```

Then run:

```sh
just db-pull  # refresh data/tabquest-turso.db; stop local dev servers first
just dev      # admin dev server against that local copy
```

`just start-dev-all` starts both local runtimes. `just sync-local-uploads`
copies receipt files from the main checkout into the worktree. A refresh
stages and validates a new SQLite file before replacing the old one, and
refuses to replace a database with WAL/SHM/journal sidecars. Neither dev
runtime needs a Turso write token. Local edits never write back to Turso.

Production updates run **only** from the main checkout on branch `main`:

```sh
just update-prod
```

The command checks the admin service configuration and every published
receipt image against Turso, builds and restarts admin, waits for a database
read, then builds and deploys public with the images. It checks an image URL
on the new Vercel deployment. A failed check stops the command and reports
which step failed. It does not run from a worktree or publish this worktree's
unmerged code.

One-time production setup on this host after the worktree is merged:

1. In the main checkout, copy `.env.prod.example` to the ignored `.env.prod`
   and fill in these values:

   ```dotenv
   TABQUEST_DATABASE_URL=libsql://<db>-<org>.turso.io
   TABQUEST_DATABASE_AUTH_TOKEN=<admin write token>
   TABQUEST_TURSO_READONLY_TOKEN=<read-only token for image checks>
   VISION_API_TOKEN=<existing OCR token, if OCR is enabled>
   ```

   Run `just install-prod-env` on branch `main`. It copies `.env.prod` to
   `~/.config/tabquest/admin.env` with mode `600`; run it again whenever you
   change `.env.prod`. `just update-prod` checks that the two files match and
   never changes them itself.
2. Run `just install-prod-service`. It installs
   `deploy/tabquest-admin-user.service` as
   `~/.config/systemd/user/tabquest-admin.service` and reloads systemd without
   restarting the service. This replaces the current user unit,
   which still points at local SQLite. The production command checks that
   this unit loads the private admin env file. The `deploy/tabquest-admin.service`
   file below documents an older system-wide service and is not the active
   unit on this host.
3. `just update-prod` reads the read-only token from `.env.prod` to validate
   images without using the admin write token. Remove `VISION_API_TOKEN` and
   all database values from the
   main checkout's `.env`; the production preflight refuses to build Vercel
   while that file contains them. The admin service gets its OCR token from
   the installed `.env.prod` copy.
4. In the linked Vercel project, set `TABQUEST_DATABASE_URL` to the same
   Turso URL and `TABQUEST_DATABASE_AUTH_TOKEN` to a **read-only** token for
   Production. Set them for Preview as well if using `just publish-preview`.
   The Vercel CLI commands are `vercel env add TABQUEST_DATABASE_URL production`
   and `vercel env add TABQUEST_DATABASE_AUTH_TOKEN production`.
   `deploy/publish.ts` refreshes the Vercel project settings on each run.
5. Put the real hostnames in the main checkout's ignored `.env.local`:
   `VITE_TABQUEST_PUBLIC_ORIGIN`, `VITE_TABQUEST_ADMIN_ORIGIN`, and
   `VITE_TABQUEST_PROJECT_ROOT` (see `.env.example`). Builds compile them
   into client links, the production preflight refuses to run without them,
   and the Vercel build refuses to run without the two origins. Add the two
   origins to the Vercel project's Production environment as well, so
   Git-triggered builds get them too. They stay out of the repository;
   `just test` fails if a tracked file contains a private term (see
   `test/private-terms.test.ts`).
6. Keep `data/uploads` in the main checkout as the production upload
   directory. It must contain every image key for a published Turso bill.
   `just update-prod` refuses to deploy if one is missing or corrupt.

Before the first admin restart against Turso, confirm the Turso database has
the expected rows and take a `turso db dump` snapshot. The admin runtime
applies pending Drizzle migrations on its first database request.

Two processes run from the same build and database. The runtime split is the
security boundary: the public process denies every admin route and mutation
before route handling, and only that process is reachable through Cloudflare.

```
Cloudflare edge ──> Vercel function ──> Turso, read-only token (public site)
Tailnet users   ──> host service ──> 127.0.0.1:54096 admin runtime ──> Turso, write token
```

Bill data lives on Turso. The admin runtime connects with a write token; the
Vercel function connects with a read-only token and holds no secrets beyond
that, so bill links stay live while this host is asleep and every publish
ships fresh data without a database snapshot. Publishing now only stages
receipt images: `just publish` copies `data/uploads`, builds through Nitro,
and deploys. The laptop-hosted public path is retired: the public quadlet is
stopped and the cloudflare tunnel deleted (2026-09-09). Section 4 documents
how to bring it back if ever needed.

## Vercel public hosting

One-time setup (on the machine that publishes):

```sh
vercel login
vercel link --yes --project tabquest
vercel pull --yes --environment=production # publish.ts refreshes this on every run
# Function environment: the database url and the read-only token.
vercel env add TABQUEST_DATABASE_URL production        # libsql://<db>-<org>.turso.io
vercel env add TABQUEST_DATABASE_AUTH_TOKEN production # read-only token
```

Everything else about the deployment is versioned in the repository:

- `vercel.json` pins the build command (`bun run build:vercel`).
- `vite.config.ts` enables the Nitro Vercel preset only for that target,
  pins the `nodejs24.x` function runtime, includes
  `deploy/snapshot/uploads/**` in the function, and bakes the function's
  static environment: `TABQUEST_RUNTIME=public` plus the uploads path. The
  database url and token come from the project's environment variables, so
  the deployed function can read but never write.

Publishing, from the shell:

- `just update-prod` updates both admin and public from the main checkout.
  `just publish` runs `deploy/publish.ts` for public only: it stages uploads,
  builds, and deploys. `just publish-preview` deploys to a preview URL first.
  `just stage-snapshot` only stages `deploy/snapshot/` for inspection.
- The admin nav shows `just publish` as a click-to-copy chip. It copies
  `cd <this checkout> && just publish`, so the command runs from any fresh
  terminal and finds the `vercel login` and `vercel link` set up there.

Publishes update public code and its bundled receipt images; bill and payment
data is served live from Turso the moment the admin runtime writes it.

Rollback to the laptop-hosted public runtime: point the Cloudflare DNS
record back at the cloudflared tunnel and `just start-all`. Nothing in the
local setup changed.

## 1. Build and lay out the app

```sh
bun install --frozen-lockfile
bun run build            # dist/client + dist/server
sudo rsync -a . /opt/tabquest --exclude node_modules --exclude .scratch
cd /opt/tabquest && bun install --frozen-lockfile --production
```

Pin the tested Bun version (1.4.0 at the time of writing). Install a
versioned copy under /opt and point the service files at it so upgrades stay
deliberate:

```sh
sudo unzip bun-1.4.0.zip -d /opt/bun-1.4.0   # creates /opt/bun-1.4.0/bin/bun
sudo ln -sfn /opt/bun-1.4.0/bin/bun /usr/local/bin/bun   # dev convenience only
```

The service units reference `/opt/bun-1.4.0/bin/bun`; when a new release is
tested, install it alongside (`/opt/bun-1.5.x`) and edit both units in one
deliberate change.

Receipt images live under `/var/lib/tabquest`; the database is remote, so
only the upload directory and the runtime env files are needed on the host:

```sh
sudo mkdir -p /var/lib/tabquest/uploads /etc/tabquest
sudo chown -R tabquest:tabquest /var/lib/tabquest
```

`/etc/tabquest/admin.env` holds the admin runtime's database settings, and
`/etc/tabquest/public.env` the public runtime's (both chmod 600, root-owned):

```sh
# /etc/tabquest/admin.env — write access
TABQUEST_DATABASE_URL=libsql://<db>-<org>.turso.io
TABQUEST_DATABASE_AUTH_TOKEN=<write token>
# /etc/tabquest/public.env — read-only token
TABQUEST_DATABASE_URL=libsql://<db>-<org>.turso.io
TABQUEST_DATABASE_AUTH_TOKEN=<read-only token>
```

Local development uses the same variable with a file url (or just the
default): `TABQUEST_DATABASE_URL=file:./data/tabquest.db` behaves exactly like
the old local database.

## 2. Systemd services

```sh
sudo cp deploy/tabquest-public.service deploy/tabquest-admin.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tabquest-admin    # migrates the DB on first start
sudo systemctl enable --now tabquest-public
```

The admin unit sets `TABQUEST_TRUST_TAILSCALE_HEADERS=true` because its port is
proxied only by Tailscale Serve, which strips incoming identity headers
before adding its own. The public unit keeps it false and mounts the data
directory read-only. Both units pull `TABQUEST_DATABASE_URL` and
`TABQUEST_DATABASE_AUTH_TOKEN` from the env files described in section 1.

## 2b. Podman quadlets (container alternative)

This deployment used to run the public runtime, admin runtime, and backup
from quadlets. All three now run without containers: the public site is the
Vercel function, and the admin runtime is a host user
service (`~/.config/systemd/user/tabquest-admin.service`, running from this
checkout). The backup service and timer were removed when the database
moved to Turso (2026-09-25); Turso's platform backups replaced them. The
host service keeps the same unit name, ports, and ordering as the quadlet,
so `just start-all` / `just restart-all` and the Tailscale wiring are
unchanged. The container layout is kept for rollback: the admin container
could not run publishes (the image ships production dependencies only, so
`deploy/publish.ts` finds no Vercel CLI and no `.vercel` project link
there). Rollback: stop the host units, restore the
`tabquest-admin.container.disabled` and
`tabquest-public.container.disabled` files in
`~/.config/containers/systemd/`, daemon-reload, start.

`deploy/quadlets/` keeps the old container layout as rootless podman user
services. One image (`deploy/Containerfile`, stage-built with the pinned Bun
release) serves both runtimes; the units differ only in `TABQUEST_RUNTIME`,
port, and trust settings. Both bind-mount `data/` from the repository
(admin `:Z`, public read-only), so the dev database is shared and the edge
wiring (cloudflared -> 48781, Tailscale Serve -> 54096) needs no changes.

```sh
podman build -t localhost/tabquest:latest -f deploy/Containerfile .
```

Units land in `~/.config/containers/systemd/` as `tabquest-admin.service` and
`tabquest-public.service`. The public unit orders after admin and both use
`Notify=healthy`, so by the time public is active the database is migrated.
Rebuild + restart recreates the containers with the fresh image.

## 3. Tailscale Serve for the admin process

On the host, expose the admin port to the tailnet:

```sh
tailscale serve --bg --https=443 http://127.0.0.1:54096
```

Restrict who may reach it with an ACL grant for the `tabquest-admin` tag or
the host's node, limited to the intended user or group. Never route the
admin port through Cloudflare.

## 4. Cloudflare Tunnel for the public hostname (retired 2026-09-09)

The tunnel was deleted when the public site moved to Vercel; the public
quadlet is retired with it (its container file sits at
`tabquest-public.container.disabled`). To bring the laptop-hosted public path
back, create a fresh tunnel and restore both pieces:

```sh
cloudflared tunnel create tabquest-public
# fill TUNNEL_ID + hostname into deploy/cloudflared-config.yml
sudo cloudflared --config deploy/cloudflared-config.yml ingress validate
sudo cp deploy/cloudflared-config.yml /etc/cloudflared/config.yml
sudo cloudflared service install
sudo systemctl enable --now cloudflared
# point the public hostname's DNS at <TUNNEL_ID>.cfargotunnel.com
mv ~/.config/containers/systemd/tabquest-public.container.disabled \
   ~/.config/containers/systemd/tabquest-public.container
systemctl --user daemon-reload && systemctl --user start tabquest-public.service
```

Also in the Cloudflare dashboard for the public hostname:

- Enable the managed WAF ruleset.
- Add a conservative per-IP rate limit on `/` and `/b/*` reads.
- Cache `assets/*` aggressively (the origin already sends immutable
  headers); give `/b/*` a short TTL or purge the URL after payment changes.
- Keep request size and header limits tight; public routes are read-only.

Firewall: both app ports bind to 127.0.0.1 only. Block inbound WAN at the
host firewall; cloudflared and Tailscale connect outbound.

## 5. The database on Turso

The database lives on Turso; every runtime opens it through
`@libsql/client` with `TABQUEST_DATABASE_URL`. Remote connections
authenticate with `TABQUEST_DATABASE_AUTH_TOKEN`: the admin runtime uses a
write token, the public runtime a read-only token, so a compromised public
process cannot mutate bill data regardless of its own route gate.

One-time setup and cutover from a local SQLite file:

```sh
turso auth login
turso db create tabquest                       # note the libsql:// url
turso db tokens create tabquest                # write token, for the admin runtime
turso db tokens create tabquest --read-only    # for the public runtime / Vercel

# Cutover (run with the write token in the environment):
export TABQUEST_DATABASE_URL=libsql://<db>-<org>.turso.io
export TABQUEST_DATABASE_AUTH_TOKEN=<write token>
just db-import                               # migrations + every table, verified
```

`just db-import` (`scripts/import-to-turso.ts`) applies pending migrations
to the target, copies every user table in batches with foreign keys
disabled, then re-counts every table against the source. It refuses to run
twice: a target that already holds rows aborts the import. Take a file copy
of `data/tabquest.db` before the first import — after the runtimes point at
Turso, the local file is a dormant snapshot, not the live database.

Roll the runtimes over by pointing them at the Turso url:

- Admin host service: put the url and write token into the service
  environment (systemd `EnvironmentFile` in the bare-metal layout) and
  `just update-prod` or restart it. Migrations now run over the wire at
  startup; the process needs network access to the Turso endpoint.
- Vercel function: `vercel env add` the url and the read-only token (see
  the Vercel section above), then `just publish`.

Backups are Turso platform backups (enabled per database in the dashboard
or with `turso db backup` where available). For a local file copy:

```sh
turso db dump tabquest > data/backups/turso-$(date +%F).sql
```

Restore into a fresh database by importing the dump through the libsql
shell (`turso db shell <new-db> < dump.sql`) and pointing the runtimes at
the new url. The old ADR rule about taking a backup before every migration
still applies in spirit: migrations run over the wire now, so dump the
database before generating one by hand.

## 6. Restoring into a clean instance

The pre-Turso sections below describe the retired file-backed layout; for
the current one, restore means creating a fresh Turso database from a dump
(see section 5) and pointing the runtimes at it. Verify a published bill
URL still resolves, then confirm the public homepage search finds the bill
by its order date.

## 7. Pre-launch checks

- `curl -s -o /dev/null -w "%{http_code}" https://<host>/admin` returns 404.
- Encoded variants (`/%61dmin`, `//admin`, `/api%2Fadmin/...`) also 404.
- The Tailscale URL loads the admin list and can flip a payment state.
- `cloudflared tunnel ingress validate` passes with the catch-all present.
- Disk space monitoring watches `/var/lib/tabquest` (receipt images).
- Turso platform backups are enabled, and a fresh `turso db dump` restores
  into a clean database.
