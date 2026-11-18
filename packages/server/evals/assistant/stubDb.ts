/**
 * Replay mode has no database. Import this FIRST: it puts a no-op Prisma stand-in in the module
 * cache so the usage ledger and budget code (which write after each model call) do nothing.
 * Vitest uses vi.mock instead (see replay.test.ts).
 */
// The order service checks this at load time. Test-only value.
process.env.JWT_SECRET ||= 'eval-replay-only-secret-0123456789abcdef';

const stub = {
  $executeRaw: async () => 1,
  assistantCallLog: { createMany: async () => ({ count: 0 }) },
  assistantDailyUsage: { updateMany: async () => ({ count: 0 }) },
};
const file = require.resolve('../../src/config/database');
require.cache[file] = { id: file, filename: file, loaded: true, exports: { prisma: stub }, children: [], paths: [] } as unknown as NodeModule;
