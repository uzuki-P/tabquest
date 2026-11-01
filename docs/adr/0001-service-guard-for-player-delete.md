# Delete protection lives in the service, not the foreign key

Whether a player can be deleted while bills still reference them is guarded by `deletePlayer` in the players service, not by the database. `bill_players.player_id` stays `ON DELETE SET NULL` rather than `ON DELETE RESTRICT`.

Moving the guarantee into the schema is unsafe in SQLite. Changing a foreign key action makes drizzle-kit emit a full table rebuild. Drizzle's migrator runs statements inside a transaction, where SQLite ignores `PRAGMA foreign_keys=OFF`, so dropping the parent table fires the children's `ON DELETE CASCADE` and erases `item_allocations`, `adjustment_allocations`, `payment_statuses`, and `payment_events`.

## Consequences

- SQLite cannot change a foreign key action without rebuilding the table, so "just change the FK" is off the table while any child table cascades from it. Any generated migration that drops or recreates a table gets audited first: check which tables reference it and with which actions.
- `src/db/migrations.test.ts` fails when a migration drops a table that other tables still cascade from, and `just update-prod` runs it before restarting admin. Do not weaken the test to let a migration through; rewrite the migration instead.
- Migrations are never applied by hand alone: the admin server runs `applyMigrations` (`src/db/client.ts`) at every startup, so `just update-prod` applies any new migration in `drizzle/` to the live Turso database. Audit and snapshot (`turso db dump`) before running it whenever `drizzle/` has changed, and keep the snapshot until the migrated data is verified.
- Removing a bad migration from the repository does not remove it from a deployed container image: the image carries its own copy of `drizzle/` and applies pending migrations at startup. Rebuild the image after deleting a migration, before restarting the service, or the restart applies it again.
- Restore a SQLite file only when no process has it, its WAL, or its SHM open. Stop every dev server and container first; an open connection can checkpoint its stale WAL over the restored data. Restart services only after the restored data is verified.
