# MASTER PLAN — Christ University Virtual Canteen System
# Based on christ-canteen-spec.md, Section 13

> **Strategy**: Enhance and extend the existing codebase (Python FastAPI + MongoDB + React vendor dashboard + Android app) rather than replacing it. Adapt the spec's Node.js/PostgreSQL/Next.js/Expo stack to work alongside and upgrade existing code.
>
> **Canteens**: Mingoes, Christ Bakery, Punjabi Bites, Michael, Freshetaria (6th TBD)
>
> **Git Rule**: Commit + push after every 2 files modified.

---

## PHASE 1 — Step 1: Project Setup & Monorepo Structure

### 1.1 Restructure into monorepo
- Files to create/modify:
  - `package.json` (root — npm workspaces)
  - `docker-compose.yml` (PostgreSQL + Redis)
  - `.env.example` + `.env`
  - Rename existing `backend/` → keep as `packages/python-service/` (ML + Python API stays)
  - Create `packages/server/` → New Node.js Express + TypeScript API
  - Create `apps/web/` → Next.js 14 vendor+admin dashboard (migrate vendor-dashboard React → Next.js)
  - Create `apps/mobile/` → Expo React Native student app
- **Git commit after**: `package.json` + `docker-compose.yml`

### 1.2 Node.js server scaffold
- Files to create:
  - `packages/server/package.json`
  - `packages/server/tsconfig.json`
  - `packages/server/src/index.ts`
  - `packages/server/prisma/schema.prisma` (copy from spec Section 4)
- **Git commit after**: `schema.prisma` + `server/src/index.ts`

### 1.3 Next.js web app scaffold
- Files to create:
  - `apps/web/package.json`
  - `apps/web/next.config.js`
  - `apps/web/tailwind.config.js`
  - `apps/web/app/layout.tsx`
- **Git commit after**: `apps/web/package.json` + `apps/web/app/layout.tsx`

### 1.4 Expo mobile app scaffold
- Files to create:
  - `apps/mobile/package.json`
  - `apps/mobile/app.json`
  - `apps/mobile/app/_layout.tsx`
  - `apps/mobile/app/(tabs)/home.tsx`
- **Git commit after**: `apps/mobile/package.json` + `apps/mobile/app.json`

---

## PHASE 2 — Step 2: Database & Auth

### 2.1 Prisma schema + migration
- Files:
  - `packages/server/prisma/schema.prisma` (full schema from spec)
  - Run: `npx prisma migrate dev --name init`
- **Git commit after**: schema + migration file

### 2.2 Firebase Auth setup
- Files:
  - `packages/server/src/config/firebase.ts`
  - `packages/server/src/middleware/auth.ts`
- **Git commit after**: firebase.ts + auth.ts

### 2.3 Auth routes
- Files:
  - `packages/server/src/routes/auth.routes.ts`
  - `packages/server/src/controllers/auth.controller.ts`
- **Git commit after**: auth.routes.ts + auth.controller.ts

### 2.4 Seed data (with real canteen names)
- Files:
  - `packages/server/prisma/seed.ts`
  - Canteens: Mingoes, Christ Bakery, Punjabi Bites, Michael, Freshetaria
- **Git commit after**: seed.ts

---

## PHASE 3 — Step 3: Canteen & Menu APIs

### 3.1 Canteen routes
- Files:
  - `packages/server/src/routes/canteen.routes.ts`
  - `packages/server/src/controllers/canteen.controller.ts`
- **Git commit after**: 2 files → commit

### 3.2 Menu routes
- Files:
  - `packages/server/src/routes/menu.routes.ts`
  - `packages/server/src/controllers/menu.controller.ts`
- **Git commit after**: 2 files → commit

### 3.3 Cloudinary image upload
- Files:
  - `packages/server/src/config/cloudinary.ts`
  - `packages/server/src/middleware/upload.ts`
- **Git commit after**: 2 files → commit

---

## PHASE 4 — Step 4: Slot System

### 4.1 Slot service + routes
- Files:
  - `packages/server/src/services/slot.service.ts`
  - `packages/server/src/routes/slot.routes.ts`
- **Git commit after**: 2 files → commit

### 4.2 Redis caching + cron
- Files:
  - `packages/server/src/config/redis.ts`
  - `packages/server/src/jobs/slotGeneration.cron.ts`
- **Git commit after**: 2 files → commit

---

## PHASE 5 — Step 5: Order System

### 5.1 Order placement
- Files:
  - `packages/server/src/services/order.service.ts`
  - `packages/server/src/controllers/order.controller.ts`
- **Git commit after**: 2 files → commit

### 5.2 QR code + Socket.IO
- Files:
  - `packages/server/src/services/qr.service.ts`
  - `packages/server/src/socket/orderSocket.ts`
- **Git commit after**: 2 files → commit

### 5.3 Order routes + auto-cancel cron
- Files:
  - `packages/server/src/routes/order.routes.ts`
  - `packages/server/src/jobs/autoCancelOrders.cron.ts`
- **Git commit after**: 2 files → commit

---

## PHASE 6 — Step 6: Wallet & Payments

### 6.1 Razorpay + wallet service
- Files:
  - `packages/server/src/config/razorpay.ts`
  - `packages/server/src/services/payment.service.ts`
- **Git commit after**: 2 files → commit

### 6.2 Wallet routes
- Files:
  - `packages/server/src/routes/wallet.routes.ts`
  - `packages/server/src/controllers/wallet.controller.ts`
- **Git commit after**: 2 files → commit

---

## PHASE 7 — Step 7: Notifications

### 7.1 FCM + notification service
- Files:
  - `packages/server/src/services/notification.service.ts`
  - `packages/server/src/routes/notification.routes.ts`
- **Git commit after**: 2 files → commit

### 7.2 Announcements
- Files:
  - `packages/server/src/controllers/notification.controller.ts`
  - `packages/server/src/routes/admin.routes.ts`
- **Git commit after**: 2 files → commit

---

## PHASE 8 — Step 8: Mobile App — Auth & Navigation

### 8.1 Expo Router + navigation
- Files:
  - `apps/mobile/app/_layout.tsx`
  - `apps/mobile/app/(auth)/login.tsx`
  - `apps/mobile/app/(auth)/register.tsx`
- **Git commit after**: login.tsx + register.tsx

### 8.2 Zustand stores + API service
- Files:
  - `apps/mobile/store/authStore.ts`
  - `apps/mobile/services/api.ts`
- **Git commit after**: 2 files → commit

---

## PHASE 9 — Step 9: Mobile App — Canteen & Menu

### 9.1 Home screen + canteen list
- Files:
  - `apps/mobile/app/(tabs)/home.tsx`
  - `apps/mobile/components/CanteenCard.tsx`
- **Git commit after**: 2 files → commit

### 9.2 Canteen menu + cart
- Files:
  - `apps/mobile/app/canteen/[id].tsx`
  - `apps/mobile/components/MenuItem.tsx`
- **Git commit after**: 2 files → commit

### 9.3 Cart + cart store
- Files:
  - `apps/mobile/app/cart.tsx`
  - `apps/mobile/store/cartStore.ts`
- **Git commit after**: 2 files → commit

---

## PHASE 10 — Step 10: Mobile App — Checkout & Orders

### 10.1 Checkout + slot picker
- Files:
  - `apps/mobile/app/checkout.tsx`
  - `apps/mobile/components/SlotPicker.tsx`
- **Git commit after**: 2 files → commit

### 10.2 Order tracking + QR display
- Files:
  - `apps/mobile/app/order/[id].tsx`
  - `apps/mobile/components/QRCodeDisplay.tsx`
- **Git commit after**: 2 files → commit

### 10.3 Orders history tab
- Files:
  - `apps/mobile/app/(tabs)/orders.tsx`
  - `apps/mobile/components/OrderStatusTracker.tsx`
- **Git commit after**: 2 files → commit

---

## PHASE 11 — Step 11: Mobile App — Wallet & Extras

### 11.1 Wallet screen
- Files:
  - `apps/mobile/app/(tabs)/wallet.tsx`
  - `apps/mobile/components/WalletCard.tsx`
- **Git commit after**: 2 files → commit

### 11.2 Profile + favorites
- Files:
  - `apps/mobile/app/(tabs)/profile.tsx`
  - `apps/mobile/services/wallet.ts`
- **Git commit after**: 2 files → commit

---

## PHASE 12 — Step 12: Vendor Dashboard (Next.js — enhance existing React)

### 12.1 Next.js migration + auth
- Files:
  - `apps/web/app/(auth)/login/page.tsx`
  - `apps/web/components/shared/Sidebar.tsx`
- **Git commit after**: 2 files → commit

### 12.2 Dashboard + live orders
- Files:
  - `apps/web/app/vendor/dashboard/page.tsx`
  - `apps/web/components/vendor/KitchenDisplay.tsx`
- **Git commit after**: 2 files → commit

### 12.3 Orders page (Kanban/slot-wise)
- Files:
  - `apps/web/app/vendor/orders/page.tsx`
  - `apps/web/components/vendor/OrderCard.tsx`
- **Git commit after**: 2 files → commit

### 12.4 Menu management
- Files:
  - `apps/web/app/vendor/menu/page.tsx`
  - `apps/web/components/vendor/MenuItemForm.tsx`
- **Git commit after**: 2 files → commit

### 12.5 QR scanner + analytics
- Files:
  - `apps/web/app/vendor/scanner/page.tsx`
  - `apps/web/app/vendor/analytics/page.tsx`
- **Git commit after**: 2 files → commit

---

## PHASE 13 — Step 13: Admin Panel

### 13.1 Admin dashboard + canteen management
- Files:
  - `apps/web/app/admin/dashboard/page.tsx`
  - `apps/web/app/admin/canteens/page.tsx`
- **Git commit after**: 2 files → commit

### 13.2 Vendor management + analytics
- Files:
  - `apps/web/app/admin/vendors/page.tsx`
  - `apps/web/app/admin/analytics/page.tsx`
- **Git commit after**: 2 files → commit

### 13.3 Announcements
- Files:
  - `apps/web/app/admin/announcements/page.tsx`
  - `apps/web/components/admin/AnalyticsCharts.tsx`
- **Git commit after**: 2 files → commit

---

## PHASE 14 — Step 14: Polish & Production

### 14.1 Loading skeletons + error handling
- Across mobile and web components

### 14.2 Zod validation on all API endpoints
- `packages/server/src/middleware/validate.ts`
- Add Zod schemas to all routes

### 14.3 Rate limiting + security headers
- `packages/server/src/middleware/rateLimiter.ts`
- Helmet, CORS config

### 14.4 GitHub Actions CI/CD
- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`

### 14.5 Production Dockerfiles
- `packages/server/Dockerfile`
- `apps/web/Dockerfile`

---

## Git Commit Schedule Summary

Every 2 files modified = 1 commit + push to GitHub (`main` branch, user: Arnav)

Total estimated commits: ~35-40 commits across all phases.

---

## What's being REUSED from existing codebase

| Existing | Reused As |
|----------|-----------|
| `backend/models.py` | Reference for Prisma schema fields |
| `backend/main.py` order logic | Reference for order.service.ts |
| `backend/token_utils.py` | Reference for qr.service.ts (JWT approach) |
| `vendor-dashboard/src/App.js` | Reference + migrate to Next.js `apps/web/` |
| `ml_service/` | Kept as-is in `packages/python-service/` — called via HTTP for ETA |
| `ChristEats/` | Reference for Android UI design while building Expo version |

---

## Tech Stack Decision

| Layer | Existing | Plan |
|-------|----------|------|
| Backend API | Python FastAPI + MongoDB | **New**: Node.js Express + PostgreSQL + Prisma (spec-aligned) + keep Python ML service |
| Vendor Web | React (CRA) | **Upgrade to**: Next.js 14 + Tailwind |
| Mobile | Kotlin Android | **New**: Expo React Native (spec requires cross-platform) |
| Database | MongoDB | **New**: PostgreSQL (via Docker) + keep MongoDB for ML/Python service |
| Auth | None (token only) | Firebase Auth |
| Cache | None | Redis |
| Payments | None | Razorpay |

---

*Review this plan → approve → I'll start Step 1 immediately.*
