// Entry point of the Cloud Functions bundle (scripts/build-shared.mjs →
// functions/src/generated/shared.cjs). Export here only PURE modules from
// src/shared/ — the functions require the bundle, never src/ directly.
export * from './caseState.js'
