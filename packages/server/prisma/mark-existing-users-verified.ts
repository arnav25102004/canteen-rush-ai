/**
 * One-time rollout helper for the "verified email required" change.
 *
 * Accounts registered before that change were never asked to verify, so they
 * would all be locked out (older app builds can't even show the verify screen).
 * This marks their Firebase accounts as verified, but only for users who
 * already exist in our database, aren't deleted or banned, and whose email is
 * on an active institution's domain.
 *
 * Dry run by default; pass --apply to write. --before=YYYY-MM-DD limits it to
 * accounts created before that date (use the deploy date).
 *
 *   npm run verify-existing-users -- --before=2026-11-14
 *   npm run verify-existing-users -- --before=2026-11-14 --apply
 */
import 'dotenv/config';
import { getAuth } from 'firebase-admin/auth';
import { getApps } from 'firebase-admin/app';
import { prisma } from '../src/config/database';
import '../src/config/firebase'; // initialises Firebase Admin from the usual env vars / JSON file

async function main() {
  const apply = process.argv.includes('--apply');
  const beforeArg = process.argv.find((a) => a.startsWith('--before='))?.split('=')[1];
  const before = beforeArg ? new Date(`${beforeArg}T00:00:00+05:30`) : new Date();
  if (Number.isNaN(before.getTime())) throw new Error('--before must be YYYY-MM-DD');
  if (!getApps().length) throw new Error('Firebase Admin is not configured (FIREBASE_* env vars or firebase-service-account.json)');

  const domains = (await prisma.institution.findMany({ where: { isActive: true }, select: { emailDomain: true } }))
    .map((i) => i.emailDomain.toLowerCase());
  const onInstitutionDomain = (email: string) => {
    const domain = email.split('@')[1]?.toLowerCase() ?? '';
    return domains.some((d) => domain === d || domain.endsWith(`.${d}`));
  };

  const users = await prisma.user.findMany({
    where: {
      createdAt: { lt: before },
      isDeleted: false,
      isBanned: false,
      NOT: [{ firebaseUid: { startsWith: 'dev_' } }, { firebaseUid: { startsWith: 'deleted_' } }],
    },
    select: { firebaseUid: true, email: true },
  });

  let updated = 0, alreadyVerified = 0, skipped = 0;
  for (const u of users) {
    if (!onInstitutionDomain(u.email)) { skipped++; continue; }
    try {
      const fbUser = await getAuth().getUser(u.firebaseUid);
      if (fbUser.emailVerified) { alreadyVerified++; continue; }
      if (fbUser.email?.toLowerCase() !== u.email.toLowerCase()) { skipped++; continue; } // emails disagree: leave for a human
      if (apply) await getAuth().updateUser(u.firebaseUid, { emailVerified: true });
      updated++;
    } catch (err) {
      skipped++;
      console.warn(`skip ${u.email}: ${(err as Error).message}`);
    }
  }

  console.log(`${apply ? 'Marked' : 'Would mark'} ${updated} verified · ${alreadyVerified} already verified · ${skipped} skipped (of ${users.length})`);
  if (!apply) console.log('Dry run only. Re-run with --apply to write.');
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
