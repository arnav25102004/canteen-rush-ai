# CLAUDE.md

Guidance for Claude Code in this repository. See README.md for setup.

## Layout

- `packages/server`: Express API. Routes are in `src/routes`, handlers in `src/controllers`, business logic in `src/services`, and the Prisma schema in `prisma/schema.prisma`.
- `apps/web`: Next.js vendor and admin portal (`app/vendor/*`, `app/admin/*`). The API client is `lib/api.ts`.
- `apps/mobile`: Expo student app (expo-router). State lives in `store/*` (zustand) and the API client in `services/api.ts`.

## Commands (packages/server)

```bash
npm run dev                 # ts-node-dev on :3001
npx tsc --noEmit -p .       # typecheck
npm test                    # vitest; set TEST_DATABASE_URL for the Postgres integration tests
npx prisma migrate dev      # new migration after editing schema.prisma
```

## Order lifecycle

`PENDING` (Razorpay only, awaiting webhook) → `CONFIRMED` → `ACCEPTED` → `PREPARING` → `READY` → `PICKED_UP`. An order can be `CANCELLED` from `PENDING`, `CONFIRMED` or `ACCEPTED`.

- Payment method is decided server-side in `services/order.service.ts` (`decidePayment`): `WALLET` (fully covered), `RAZORPAY`, or `CASH` (pay at counter, marked `PAID` by `scanQR`).
- Cancels always go through `cancelOrder()`. It frees the slot and returns wallet credit, captured online payments and redeemed points. Never refund the cash part of an order.

## Rules that matter

- **Auth**: `config/firebase.ts` `verifyFirebaseToken` requires a verified email. Mock `dev.*.mock` tokens work only with `NODE_ENV!=production` and `DEV_AUTH=true`.
- **Registration**: never takes `role` or `email` from the request body. Email comes from the token, and the role from `ADMIN_EMAILS` (otherwise `STUDENT`).
- **Vendor endpoints**: scope every query to the vendor's canteen with `canteenScope(req)` from `middleware/auth.ts`.
- **Routers**: import `Router` from `utils/router`, not from `express`. It forwards async errors to the error handler (Express 4 would otherwise crash the process).
- **Money and state changes**: use conditional `updateMany` (checking the expected status or balance) inside `prisma.$transaction`, not read-then-write.
- **Redis**: optional. Use `cacheGet`, `cacheSet` and `cacheDel` from `config/redis.ts`; they never throw.
- **Time**: slot dates are calendar dates, and times are IST. Use `slotStartsAt` and `istDateKey` from `utils/helpers.ts`.
