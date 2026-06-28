import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Three test suites share this config:
//
//   tests/utils/      pure utils (no I/O, no DOM)             -> npm test
//   tests/rules/      Firestore rules unit tests via emulator -> npm run test:rules
//   tests/components/ React component smoke tests (jsdom)     -> npm run test:components
//
// Rules tests connect to the Firestore emulator over gRPC. Each Vitest
// worker that touches initializeTestEnvironment() starts its own gRPC
// channel. Running 5 test files in parallel ends up spawning 5 worker
// processes with 5 independent gRPC stacks, which OOM'd a Windows
// machine during local runs. Single-fork mode runs all test files
// sequentially in one worker process, which is plenty fast for this
// suite (~25 seconds end-to-end including emulator boot).
//
// The component tests under tests/components/ need jsdom + the React
// plugin to compile JSX. They're configured per-file with `// @vitest-
// environment jsdom` headers OR can rely on the workspace default below.
// The utils tests don't need either; they pay no cost from a top-level
// jsdom default thanks to Vitest's per-file environment isolation.
export default defineConfig({
  plugins: [react()],
  pool: 'forks',
  poolOptions: {
    forks: {
      singleFork: true,
    },
  },
  test: {
    fileParallelism: false,
    // Default to jsdom so component tests don't need a per-file
    // // @vitest-environment header. Utils tests opt out below
    // because jsdom env-load was the bottleneck (~7s) on the
    // pre-commit hook.
    environment: 'jsdom',
    // Per-folder environment overrides. tests/utils/ runs in pure
    // node -- no DOM, no jsdom boot cost. Cuts pre-commit hook from
    // ~15s to ~3s.
    environmentMatchGlobs: [
      ['tests/utils/**', 'node'],
      ['tests/rules/**', 'node'],
    ],
    setupFiles: ['./tests/setup.js'],
    exclude: ['node_modules', 'dist', '.idea', '.git'],
  },
})
