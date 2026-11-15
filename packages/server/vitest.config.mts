import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The *.integration.test.ts suites share one Postgres database (TEST_DATABASE_URL);
    // running files in parallel lets them interfere, so run files one at a time.
    fileParallelism: false,
    // Several suites re-import modules per test (env-dependent config); allow for slow CI disks.
    testTimeout: 20_000,
  },
});
