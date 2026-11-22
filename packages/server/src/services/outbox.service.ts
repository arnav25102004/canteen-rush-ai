import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';
import { deliverOrderNotification, OrderNotificationEvent } from './notification.service';
import { awardPointsForOrder } from './loyalty.service';

/**
 * Transactional outbox: slow side effects are written in the same transaction as
 * the business change, then run by a worker. A crash cannot lose them, and the
 * request never waits on FCM. Delivery is at-least-once.
 */
export type OutboxEvent =
  | { type: 'notification.order'; payload: OrderNotificationEvent }
  | { type: 'loyalty.award'; payload: { orderId: string } }
  | { type: 'menu.totalOrders'; payload: { items: Array<{ menuItemId: string; quantity: number }> } };

type Client = Prisma.TransactionClient | typeof prisma;

interface Row {
  id: bigint;
  type: OutboxEvent['type'];
  payload: unknown;
  attempts: number;
}

const BATCH = 100;
const POLL_MS = 500;
const MAX_ATTEMPTS = 8;
const LOCK_EXPIRY = '2 minutes';
const DEAD_RETENTION_MS = 30 * 24 * 60 * 60_000;
const PRUNE_EVERY_MS = 60 * 60_000;

export function enqueue(client: Client, event: OutboxEvent) {
  return client.outboxEvent.create({ data: { type: event.type, payload: event.payload as Prisma.InputJsonValue } });
}

export function enqueueMany(client: Client, events: OutboxEvent[]) {
  return client.outboxEvent.createMany({
    data: events.map((e) => ({ type: e.type, payload: e.payload as Prisma.InputJsonValue })),
  });
}

async function claim(): Promise<Row[]> {
  // An event that keeps killing its worker never reaches fail(), so retire it here.
  const dead = await prisma.$executeRaw(Prisma.sql`
    UPDATE outbox_events
    SET status = 'DEAD', locked_at = NULL, last_error = COALESCE(last_error, 'Worker stopped while processing')
    WHERE status = 'PROCESSING' AND attempts >= ${MAX_ATTEMPTS} AND locked_at < now() - ${LOCK_EXPIRY}::interval`);
  if (dead > 0) {
    metrics.inc('outbox_dead_total', undefined, dead);
    logger.error('Outbox events moved to dead letter after worker failures', { count: dead });
  }
  // SKIP LOCKED lets any number of workers run. A worker that died mid-event
  // loses its claim after LOCK_EXPIRY and the event is retried.
  return prisma.$queryRaw<Row[]>(Prisma.sql`
    UPDATE outbox_events SET status = 'PROCESSING', locked_at = now(), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM outbox_events
      WHERE (status = 'PENDING' AND available_at <= now())
         OR (status = 'PROCESSING' AND locked_at < now() - ${LOCK_EXPIRY}::interval)
      ORDER BY id LIMIT ${BATCH}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, attempts`);
}

async function fail(row: Row, err: unknown) {
  const message = (err as Error)?.message?.slice(0, 500) ?? 'unknown';
  const dead = row.attempts >= MAX_ATTEMPTS;
  const delaySeconds = Math.min(2 ** row.attempts, 300);
  await prisma.outboxEvent.update({
    where: { id: row.id },
    data: {
      status: dead ? 'DEAD' : 'PENDING',
      lockedAt: null,
      lastError: message,
      availableAt: new Date(Date.now() + delaySeconds * 1000),
    },
  });
  metrics.inc(dead ? 'outbox_dead_total' : 'outbox_retries_total');
  if (dead) logger.error('Outbox event moved to dead letter', { id: String(row.id), type: row.type, error: message });
}

/** Counter bumps from the whole batch become one update per item, applied with the delete. */
async function applyTotals(rows: Row[]) {
  if (!rows.length) return;
  const totals = new Map<string, number>();
  for (const row of rows) {
    for (const { menuItemId, quantity } of (row.payload as { items: Array<{ menuItemId: string; quantity: number }> }).items) {
      totals.set(menuItemId, (totals.get(menuItemId) ?? 0) + quantity);
    }
  }
  const ordered = [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)); // stable lock order
  await prisma.$transaction([
    ...ordered.map(([id, quantity]) => prisma.menuItem.updateMany({ where: { id }, data: { totalOrders: { increment: quantity } } })),
    prisma.outboxEvent.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } }),
  ]);
}

/** Runs one batch. Returns how many events were claimed. */
export async function processOutboxBatch(): Promise<number> {
  const rows = await claim();
  const totals = rows.filter((r) => r.type === 'menu.totalOrders');
  try {
    await applyTotals(totals);
    metrics.inc('outbox_processed_total', undefined, totals.length);
  } catch (err) {
    await Promise.all(totals.map((r) => fail(r, err)));
  }

  await Promise.all(rows.filter((r) => r.type !== 'menu.totalOrders').map(async (row) => {
    try {
      if (row.type === 'loyalty.award') await awardPointsForOrder((row.payload as { orderId: string }).orderId);
      else await deliverOrderNotification(row.payload as OrderNotificationEvent);
      await prisma.outboxEvent.delete({ where: { id: row.id } });
      metrics.inc('outbox_processed_total');
    } catch (err) {
      await fail(row, err).catch((e) => logger.error('Outbox failure not recorded', { error: (e as Error)?.message }));
    }
  }));
  return rows.length;
}

/** Polls until stopped; drains quickly while there is a backlog. Returns the stop function. */
export function startOutboxWorker(): () => Promise<void> {
  let stopped = false;
  let wake: (() => void) | null = null;
  let lastPrune = 0;
  const loop = (async () => {
    while (!stopped) {
      let claimed = 0;
      try {
        if (Date.now() - lastPrune >= PRUNE_EVERY_MS) {
          lastPrune = Date.now();
          await prisma.outboxEvent.deleteMany({ where: { status: 'DEAD', createdAt: { lt: new Date(Date.now() - DEAD_RETENTION_MS) } } });
        }
        claimed = await processOutboxBatch();
      } catch (err) {
        logger.error('Outbox batch failed', { error: (err as Error)?.message });
      }
      if (claimed < BATCH && !stopped) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, POLL_MS).unref();
        });
      }
    }
  })();
  return async () => {
    stopped = true;
    wake?.();
    await loop;
  };
}
