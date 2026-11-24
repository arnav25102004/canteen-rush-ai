import { prisma } from '../config/database';
import { cached, invalidate } from '../config/cache';

const key = (firebaseUid: string) => `auth:${firebaseUid}`;

/**
 * The user row behind a verified token. Cached for 30s with no stale window, so
 * a DB outage never extends a ban or role. Every write that changes identity,
 * role, ban or canteen must call invalidateAuthUser*.
 */
export function getAuthUser(firebaseUid: string) {
  return cached(
    key(firebaseUid),
    () => prisma.user.findUnique({
      where: { firebaseUid },
      include: { vendorCanteen: { select: { id: true } } },
    }),
    { ttl: 30, stale: 0, cacheIf: (u) => !!u },
  );
}

export function invalidateAuthUser(firebaseUid: string) {
  return invalidate(key(firebaseUid));
}

export async function invalidateAuthUserById(...ids: Array<string | null | undefined>) {
  const wanted = ids.filter((id): id is string => !!id);
  if (!wanted.length) return;
  const rows = await prisma.user.findMany({ where: { id: { in: wanted } }, select: { firebaseUid: true } });
  await invalidate(...rows.map((r) => key(r.firebaseUid)));
}
