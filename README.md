# Campus Khana (canteen-rush-ai)

Pre-order system for university canteens. Students order from the mobile app, vendors run a live order board on the web, and admins manage canteens, users and settlements.

| Part | Path | Stack | Port |
|------|------|-------|------|
| API server | `packages/server` | Express, Prisma (Postgres), Socket.IO, Firebase Admin, optional Redis | 3001 |
| Vendor & admin web | `apps/web` | Next.js 14, Firebase Auth | 3000 |
| Student app | `apps/mobile` | Expo / React Native, Firebase Auth | 8085 (Metro) |

## Run locally

1. **Databases**: `docker compose up -d` starts Postgres (5432) and Redis (6379). Redis is optional.
2. **Server**
   ```bash
   cd packages/server
   cp ../../.env.example .env        # fill in values
   npm install
   npx prisma migrate deploy
   npm run seed                      # optional demo data
   npm run dev
   ```
   Without Firebase credentials, set `DEV_AUTH=true` (never in production) to use `POST /api/auth/dev-login`.
3. **Web**: `cd apps/web && npm install && npm run dev`. Set `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SOCKET_URL` and the `NEXT_PUBLIC_FIREBASE_*` values in `.env.local`.
4. **Mobile**: `cd apps/mobile && npm install --legacy-peer-deps && npm start`. Set `EXPO_PUBLIC_API_URL` to your server's `/api` URL.

## Tests

```bash
cd packages/server
npm test
# Order money-flow tests against a real Postgres:
TEST_DATABASE_URL=postgresql://... npm test
```

## Accounts and roles

- Everyone signs up with their institution email, and must verify it before logging in.
- New accounts are `STUDENT`. Emails listed in `ADMIN_EMAILS` become `ADMIN`.
- Admins promote vendors from **Admin → Users**, then assign them to a canteen from **Admin → Vendors**.

## Payments

- With `RAZORPAY_ENABLED=false` (default), orders are **pay at counter**. They stay `AWAITING_PAYMENT` and become `PAID` when the vendor scans the pickup QR.
- With `RAZORPAY_ENABLED=true` and a canteen `razorpayAccountId`, orders are paid online and confirmed by the webhook (`RAZORPAY_WEBHOOK_SECRET`).
- Wallet credit (refunds) and loyalty points are applied automatically at checkout and returned if the order is cancelled.

Deployment: `render.yaml` (API + Postgres), `apps/web/vercel.json` (web), `apps/mobile/eas.json` (app builds).
