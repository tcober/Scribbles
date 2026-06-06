# Project conventions

## Code style

- **No single-letter variable names.** Use whole words that fit the case —
  e.g. `index` (not `i`), `event` (not `e`), `chunk` (not `c`), `note` (not `n`),
  `match` (not `m`). This applies to loop counters, callback parameters,
  array-method callbacks (`map`/`filter`/`forEach`/etc.), and `v-for` aliases.

- **Vue SFC block order:** `<template>` first, then `<script setup>`, then
  `<style scoped>`.
