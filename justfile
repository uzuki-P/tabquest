# List the available project commands.
default:
    @just --list

# Start the admin dev server on loopback port 46533 with the local Turso copy.
# Published to the tailnet at https://tabquest-dev.example.ts.net
dev: dev-local

# Copy receipt images from the main checkout into this worktree.
sync-local-uploads:
    #!/usr/bin/env bash
    set -euo pipefail
    source_dir="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/data/uploads"
    test -d "$source_dir" || { echo "Upload source not found: $source_dir" >&2; exit 1; }
    mkdir -p data/uploads
    if [[ "$source_dir" != "$(pwd -P)/data/uploads" ]]; then
        rsync -a --ignore-existing "$source_dir/" data/uploads/
    fi

# Run the admin dev server against the read-only Turso pull stored locally.
dev-local: sync-local-uploads
    test -f data/tabquest-turso.db || { echo "Run just db-pull first." >&2; exit 1; }
    TABQUEST_DATABASE_URL=file:./data/tabquest-turso.db bun run dev:admin

# Run both local sites against the downloaded SQLite file.
start-dev-local-all: sync-local-uploads
    test -f data/tabquest-turso.db || { echo "Run just db-pull first." >&2; exit 1; }
    TABQUEST_DATABASE_URL=file:./data/tabquest-turso.db bun run --parallel dev:public dev:admin

# Run the public and admin dev servers with the local Turso copy.
# Admin: https://tabquest-dev.example.ts.net (loopback 46533)
# Public: https://tabquest-dev-public.example.ts.net (loopback 46534)
start-dev-all: start-dev-local-all

# Run the full test suite (domain, services, gate, components, e2e).
test:
    bun test

# Run only the fast unit and component tests.
test-unit:
    bun test src test/preload.ts

# Typecheck the project.
typecheck:
    bun run typecheck

# Lint the project.
lint:
    bun run lint

# Format the project.
format:
    bun run format

# Build the production client and server bundles.
build:
    bun run build

# Run the admin runtime on its static loopback port after a build.
start-admin:
    TABQUEST_RUNTIME=admin TABQUEST_PORT=54096 bun run scripts/serve.ts

# Run the public runtime on its static loopback port after a build.
start-public:
    TABQUEST_RUNTIME=public TABQUEST_PORT=48781 bun run scripts/serve.ts

# Run both runtimes side by side in plain bun processes (no containers).
start-all-bun:
    bun run --parallel start:public start:admin

# ---- Admin host service (the public site deploys to Vercel) ----

admin_service := "tabquest-admin.service"

# Start the admin host service.
start-all:
    systemctl --user start {{admin_service}}

# Stop the admin host service.
stop-all:
    systemctl --user stop {{admin_service}}

# Restart the admin host service from the current dist build.
restart-all:
    systemctl --user restart {{admin_service}}

# Deploy admin and public from the main checkout on main, including images.
update-prod: deploy-admin
    bun run deploy/publish.ts

# Check, build, and restart admin from the main checkout on main, then wait for a database read.
deploy-admin:
    #!/usr/bin/env bash
    set -euo pipefail
    # Admin applies pending migrations on restart; refuse cascading drops.
    bun test src/db/migrations.test.ts
    bun run deploy/check-prod.ts
    bun run build
    systemctl --user restart {{admin_service}}
    systemctl --user is-active --quiet {{admin_service}}
    for attempt in {1..15}; do
        code=$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:54096/api/public/bills/update-prod-healthcheck 2>/dev/null || true)
        if [[ "$code" == 404 ]]; then exit 0; fi
        sleep 1
    done
    echo "Admin did not pass its database-backed health check." >&2
    exit 1

# Run by tabquest-admin-deploy.service: deploy admin at the new main commit when the tree is clean.
auto-deploy-admin:
    #!/usr/bin/env bash
    set -euo pipefail
    head=$(git rev-parse HEAD)
    if [[ "$(git branch --show-current)" != main ]]; then
        echo "Skipped: the main checkout is not on branch main."
        exit 0
    fi
    if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
        echo "Skipped: the main checkout has uncommitted changes." >&2
        exit 1
    fi
    state="$(git rev-parse --git-common-dir)/tabquest-admin-deployed"
    if [[ -f "$state" && "$(cat "$state")" == "$head" ]]; then
        echo "Skipped: $head is already deployed."
        exit 0
    fi
    echo "Deploying admin at $head."
    just deploy-admin
    echo "$head" > "$state"

# Install the admin auto-deploy unit and git hook in the main checkout.
install-auto-deploy:
    #!/usr/bin/env bash
    set -euo pipefail
    checkout="$(git rev-parse --show-toplevel)"
    main_checkout="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
    if [[ "$(realpath "$checkout")" != "$(realpath "$main_checkout")" || "$(git branch --show-current)" != main ]]; then
        echo "install-auto-deploy only runs in the main checkout on branch main." >&2
        exit 1
    fi
    unit_dir="$HOME/.config/systemd/user"
    install -m 644 -D deploy/tabquest-admin-deploy.service "$unit_dir/tabquest-admin-deploy.service"
    tool_path="$(dirname "$(command -v bun)"):$(dirname "$(command -v just)"):/usr/local/bin:/usr/bin:/bin"
    mkdir -p "$unit_dir/tabquest-admin-deploy.service.d"
    printf '# Host-specific paths for this machine (kept out of the public repository).\n[Service]\nWorkingDirectory=%s\nEnvironment=PATH=%s\n' \
        "$main_checkout" "$tool_path" > "$unit_dir/tabquest-admin-deploy.service.d/host.conf"
    install -m 755 deploy/hooks/reference-transaction "$(git rev-parse --git-common-dir)/hooks/reference-transaction"
    systemctl --user daemon-reload
    echo "Installed. Each new commit on main now redeploys admin; follow it with: just logs admin-deploy"

# Install the private admin env file from the main checkout for systemd.
install-prod-env:
    #!/usr/bin/env bash
    set -euo pipefail
    checkout="$(git rev-parse --show-toplevel)"
    main_checkout="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
    if [[ "$(realpath "$checkout")" != "$(realpath "$main_checkout")" || "$(git branch --show-current)" != main ]]; then
        echo "install-prod-env only runs in the main checkout on branch main." >&2
        exit 1
    fi
    test -f .env.prod || { echo "Create .env.prod from .env.prod.example first." >&2; exit 1; }
    if grep -q '<' .env.prod; then echo "Replace the placeholders in .env.prod first." >&2; exit 1; fi
    grep -q '^TABQUEST_DATABASE_URL=libsql://' .env.prod || { echo "Set the Turso URL in .env.prod." >&2; exit 1; }
    grep -q '^TABQUEST_DATABASE_AUTH_TOKEN=.' .env.prod || { echo "Set the admin write token in .env.prod." >&2; exit 1; }
    grep -q '^TABQUEST_TURSO_READONLY_TOKEN=.' .env.prod || { echo "Set the read-only token in .env.prod." >&2; exit 1; }
    chmod 600 .env.prod
    install -m 600 -D .env.prod "$HOME/.config/tabquest/admin.env"
    echo "Installed admin.env. Restart the admin service when ready to apply it."

# Install the admin systemd unit and reload it without restarting the service.
install-prod-service:
    #!/usr/bin/env bash
    set -euo pipefail
    checkout="$(git rev-parse --show-toplevel)"
    main_checkout="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
    if [[ "$(realpath "$checkout")" != "$(realpath "$main_checkout")" || "$(git branch --show-current)" != main ]]; then
        echo "install-prod-service only runs in the main checkout on branch main." >&2
        exit 1
    fi
    install -m 644 -D deploy/tabquest-admin-user.service "$HOME/.config/systemd/user/tabquest-admin.service"
    systemctl --user daemon-reload
    echo "Installed the admin unit. The running service was not restarted."

# Follow the last 50 log lines of a runtime: just logs [admin|public]
logs service="admin":
    journalctl --user -n 50 -f -u tabquest-{{service}}.service

# Generate a SQL migration from the Drizzle schema.
db-generate:
    bun run db:generate

# One-time cutover: apply migrations to the Turso database, then copy every
# table from the local SQLite file into it. Requires TABQUEST_DATABASE_URL
# (+ TABQUEST_DATABASE_AUTH_TOKEN) pointing at the remote database. See
# deploy/README.md, "Moving the database to Turso".
db-import:
    bun run scripts/import-to-turso.ts

# Refresh the local SQLite copy from Turso through a read-only token.
# Put the read-only URL and token in this worktree's .env.local.
db-pull target="data/tabquest-turso.db":
    bun run scripts/pull-from-turso.ts --to "{{target}}" --replace

# Copy uploads and deploy to a Vercel preview URL (bill data is read
# live from Turso).
publish-preview:
    bun run deploy/publish.ts --preview

# Copy uploads and deploy to the Vercel production domain (bill data is
# read live from Turso).
publish:
    bun run deploy/publish.ts

# Stage uploads into deploy/snapshot without building or deploying.
stage-snapshot:
    bun run deploy/publish.ts --stage-only
