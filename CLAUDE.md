# Project conventions

## Code style

- **No single-letter variable names.** Use whole words that fit the case —
  e.g. `index` (not `i`), `event` (not `e`), `chunk` (not `c`), `note` (not `n`),
  `match` (not `m`). This applies to loop counters, callback parameters,
  array-method callbacks (`map`/`filter`/`forEach`/etc.), and `v-for` aliases.

- **Vue SFC block order:** `<template>` first, then `<script setup>`, then
  `<style scoped>`.

## Renderer architecture

Container/presentational, backed by Pinia. Chosen for testability: dumb views
test via props/emits, stores test in isolation, pure logic tests directly.

- **Dumb display components** take props in and emit events out only — no
  `window.api` calls, no store access, no business logic. Keep them in
  `src/components/`.

- **Per-feature containers** (e.g. `SidebarContainer.vue`,
  `NoteEditorContainer.vue`) bind Pinia stores to the dumb components, map
  emitted events to store actions, and own view-interaction concerns like
  debounce timers and DOM listeners. `App.vue` is a thin composition shell.

- **Pinia stores** (`src/stores/`) own app state and all `window.api`/IPC calls.
  Split by what coordinates together, not by feature noun — `notes` (content)
  and `editor` (runtime/status) rather than one store per domain. Cross-store
  actions call the other store via `useOtherStore()` inside the action.

- **Pure functions** go in `src/utils/` and are unit-tested directly. Prefer
  extracting them over inlining in components or stores.

- **Imperative / DOM-bound plumbing** (recorder lifecycle, promise-serialized
  pipelines, caret sync) stays in composables (`src/composables/`) or the owning
  component — do not force it into a store.

- **Tests** use Vitest + `@vue/test-utils` + `@pinia/testing` (`npm test`).
