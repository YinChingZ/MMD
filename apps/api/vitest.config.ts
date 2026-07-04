import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 30_000,
    // repositories.test.ts and routes.test.ts both truncate the same shared
    // real Postgres (see test/db-helpers.ts) in their own beforeEach — with
    // vitest's default per-file parallelism, one file's truncate can wipe out
    // rows another file just inserted mid-test, causing spurious FK-violation
    // failures. Running test files sequentially trades a little speed for
    // integration tests that are actually deterministic.
    fileParallelism: false,
  },
});
