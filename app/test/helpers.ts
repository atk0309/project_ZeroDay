// Schema is applied by setup.ts before any test file imports.
// Helpers stay no-ops; left here so test files can `import { applySchema }`
// idempotently without us having to thread state.
export function applySchema() { /* applied in setup.ts */ }
