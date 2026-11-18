import { prisma } from '../config/database';

/** One constant per cron job; arbitrary but must stay unique and stable. */
export const LOCK_KEYS = {
  autoCancel: 7301001,
  slotGeneration: 7301002,
  assistantRetention: 7301003,
  feedbackNudge: 7301004,
  feedbackSla: 7301005,
  feedbackRetention: 7301006,
} as const;

/**
 * Runs `fn` only if no other instance currently holds the lock for `key`.
 * Returns false (and skips) when the lock is taken.
 *
 * The xact-scoped lock lives on one dedicated transaction connection; `fn`
 * itself uses the normal pool. The lock is released automatically when the
 * transaction ends, including when the process or connection dies, so a crash
 * can never leave a job permanently locked (a session lock over Prisma's pool
 * could not guarantee lock and unlock use the same connection). The long
 * timeout only has to cover the job body, which is seconds-to-minutes.
 */
export async function withAdvisoryLock(key: number, fn: () => Promise<void>): Promise<boolean> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${key}::bigint) AS locked`;
      if (!rows[0]?.locked) return false;
      await fn();
      return true;
    },
    { maxWait: 5_000, timeout: 10 * 60 * 1000 }
  );
}
