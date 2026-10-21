# Tabquest

A bill-splitting app for office group orders. It divides each receipt among the
people who ordered and turns paying up into a game, with monthly spending and
tip leaderboards and player badges.

Built with TanStack Start, React, TypeScript, shadcn/ui, Drizzle, and libSQL.
See `deploy/README.md` for hosting and `CONTEXT.md` for the domain language.

## Code checks

Run `just typecheck` for TypeScript 7 and `just lint` for Oxlint. Oxlint uses
`oxlint-tsgolint` for type-aware checks, including deprecated API usages.
Prettier still handles formatting through `just format`.

The Oxlint config preserves 65 supported rules from the previous ESLint config.
It also checks deprecated APIs. Four previous rules have no native equivalent:
type-parameter naming, preferring `node:` import prefixes, comment spacing, and
legacy octal syntax. Generated routes, static assets, and build output remain
outside lint checks.

## Adding components

To add components to your app, run the following command:

```bash
npx shadcn@latest add button
```

This will place the ui components in the `components` directory.

## Using components

To use the components in your app, import them as follows:

```tsx
import { Button } from "@/components/ui/button"
```
