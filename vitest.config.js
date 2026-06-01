import { defineConfig } from 'vitest/config'

// Rules tests connect to the Firestore emulator over gRPC. Each Vitest
// worker that touches initializeTestEnvironment() starts its own gRPC
// channel. Running 5 test files in parallel ends up spawning 5 worker
// processes with 5 independent gRPC stacks, which OOM'd a Windows
// machine during local runs. Single-fork mode runs all test files
// sequentially in one worker process, which is plenty fast for this
// suite (~25 seconds end-to-end including emulator boot).
//
// The utils tests under tests/utils/ don't touch any emulator and
// don't suffer the same constraint -- they ignore this config when
// invoked via `vitest run tests/utils` from a different working set.
export default defineConfig({
  // Vitest 4 moved pool and poolOptions to top-level (out of test.*).
  pool: 'forks',
  poolOptions: {
    forks: {
      singleFork: true,
    },
  },
  test: {
    fileParallelism: false,
  },
})