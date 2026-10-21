## Agent skills

### Issue tracker

Issues are Markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the default canonical labels. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository. See `docs/agents/domain.md`.

## Database migrations

Before generating or applying a Drizzle migration or changing `src/db/schema.ts`: read `docs/adr/0001-service-guard-for-player-delete.md`. A rebuild migration cascade-wiped live tables on 2026-09-03, so audit any generated migration that drops or recreates a table first. The database lives on Turso (deploy/README.md section 5); snapshot it with `turso db dump` before applying a risky migration, and never import data into a database that already has rows (`just db-import` refuses).

## Refactoring

Refactor freely when the current structure is bad, and keep the YAGNI vibe: build for the problems the code has today, not for hypothetical futures. Before refactoring, tell the user first and give concrete examples of why the current structure fails, for example duplicated logic that has already drifted apart, or a small feature that turns into a hunt through tangled code. Get their OK before touching the code.
