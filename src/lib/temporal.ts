// Safari ships without the Temporal global (Chromium, Firefox, and Bun all
// have it natively). Importing this module anywhere in the client graph keeps
// the app from crashing with "Can't find variable: Temporal" on iOS.
// The polyfill is spec-compliant; engines with a native Temporal keep theirs.
import { Temporal } from "temporal-polyfill"

const globalScope = globalThis as { Temporal?: unknown }
globalScope.Temporal ??= Temporal
