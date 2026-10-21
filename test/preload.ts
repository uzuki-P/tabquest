import { GlobalRegistrator } from "@happy-dom/global-registrator"

// Component tests need the DOM. happy-dom also replaces web platform
// constructors like File and FormData with its own; Bun's natives serialise
// correctly over fetch, so restore them after registering to keep network
// tests (and multipart uploads) working under bun:test.
const natives = {
  fetch: globalThis.fetch,
  File: globalThis.File,
  FormData: globalThis.FormData,
  Blob: globalThis.Blob,
  Headers: globalThis.Headers,
  Request: globalThis.Request,
  Response: globalThis.Response,
}

GlobalRegistrator.register()
Object.assign(globalThis, natives)

// Imported after registration so Testing Library sees the DOM globals.
await import("@testing-library/jest-dom/vitest")
