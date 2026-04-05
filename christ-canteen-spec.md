# Christ University Virtual Canteen System — Complete Technical Specification

> **Purpose**: This document is a complete, self-contained specification for building the Christ University Virtual Canteen System from scratch. It is designed to be fed directly to an AI coding agent (Claude Code) to build the entire project step by step.

---

## 1. Project Overview

### Problem
Christ University has multiple canteens across campuses. At peak hours (especially 9:15 AM breakfast), massive crowds form causing long waits, chaos, and poor experience. Students waste class time standing in lines.

### Solution
A pre-ordering system where students select a canteen, browse its full menu, place orders in advance for specific pickup time slots, pay digitally, and collect via QR code — eliminating crowding by distributing demand across time slots.

### Users & Roles
| Role | Platform | Description |
|------|----------|-------------|
| Student | Mobile App (React Native) | Browse canteens, view menus, pre-order, pay, track orders, show QR at pickup |
| Vendor | Web App (Next.js) | Manage their canteen's menu, view/process orders by slot, scan QR for pickup |
| Super Admin | Web App (Next.js) | Manage all canteens, assign vendors, view cross-canteen analytics |

---

## 2. Tech Stack

### Frontend
- **Student Mobile App**: React Native (Expo) with TypeScript
- **Vendor Dashboard**: Next.js 14 (App Router) with TypeScript + Tailwind CSS
- **Admin Panel**: Next.js 14 (App Router) with TypeScript + Tailwind CSS (can be same app as vendor with role-based routing)

### Backend
- **API Server**: Node.js with Express.js + TypeScript
- **Database**: PostgreSQL (primary) with Prisma ORM
- **Cache/Realtime**: Redis for slot availability caching + live order updates
- **Authentication**: Firebase Auth (email/password + Google Sign-In)
- **File Storage**: Cloudinary (menu item images, canteen banners)
- **Push Notifications**: Firebase Cloud Messaging (FCM)
- **Payments**: Razorpay (UPI, cards, wallet recharge)
- **QR Codes**: `qrcode` npm package for generation, device camera for scanning
- **WebSockets**: Socket.IO for real-time order status updates

### Infrastructure
- **Hosting**: Railway / Render / AWS EC2 (backend), Vercel (web apps)
- **CI/CD**: GitHub Actions
- **Monitoring**: Sentry for error tracking

---

## 3. Project Structure

```
christ-canteen/
├── apps/
│   ├── mobile/                    # React Native (Expo) student app
│   │   ├── app/                   # Expo Router screens
│   │   │   ├── (auth)/
│   │   │   │   ├── login.tsx
│   │   │   │   └── register.tsx
│   │   │   ├── (tabs)/
│   │   │   │   ├── home.tsx           # Canteen list
│   │   │   │   ├── orders.tsx         # Order history
│   │   │   │   ├── wallet.tsx         # Wallet & transactions
│   │   │   │   └── profile.tsx        # User profile & settings
│   │   │   ├── canteen/
│   │   │   │   └── [id].tsx           # Full menu for selected canteen
│   │   │   ├── cart.tsx
│   │   │   ├── checkout.tsx           # Slot selection + payment
│   │   │   ├── order/
│   │   │   │   └── [id].tsx           # Order tracking + QR code
│   │   │   └── _layout.tsx
│   │   ├── components/
│   │   │   ├── CanteenCard.tsx
│   │   │   ├── MenuItem.tsx
│   │   │   ├── CartItem.tsx
│   │   │   ├── SlotPicker.tsx
│   │   │   ├── OrderStatusTracker.tsx
│   │   │   ├── QRCodeDisplay.tsx
│   │   │   └── WalletCard.tsx
│   │   ├── services/
│   │   │   ├── api.ts                 # Axios instance + interceptors
│   │   │   ├── auth.ts
│   │   │   ├── canteen.ts
│   │   │   ├── menu.ts
│   │   │   ├── order.ts
│   │   │   ├── payment.ts
│   │   │   ├── wallet.ts
│   │   │   └── socket.ts             # Socket.IO client
│   │   ├── store/                     # Zustand state management
│   │   │   ├── authStore.ts
│   │   │   ├── cartStore.ts
│   │   │   └── orderStore.ts
│   │   ├── types/
│   │   │   └── index.ts
│   │   ├── app.json
│   │   └── package.json
│   │
│   └── web/                       # Next.js vendor + admin dashboard
│       ├── app/
│       │   ├── (auth)/
│       │   │   └── login/page.tsx
│       │   ├── vendor/
│       │   │   ├── dashboard/page.tsx     # Order overview for today
│       │   │   ├── orders/page.tsx        # Slot-wise order management
│       │   │   ├── menu/page.tsx          # Menu CRUD for their canteen
│       │   │   ├── menu/[itemId]/page.tsx # Edit menu item
│       │   │   ├── scanner/page.tsx       # QR scanner for pickup
│       │   │   ├── analytics/page.tsx     # Sales & performance
│       │   │   └── settings/page.tsx
│       │   ├── admin/
│       │   │   ├── dashboard/page.tsx     # Cross-canteen overview
│       │   │   ├── canteens/page.tsx      # Manage all canteens
│       │   │   ├── canteens/[id]/page.tsx # Edit canteen details
│       │   │   ├── vendors/page.tsx       # Vendor account management
│       │   │   ├── analytics/page.tsx     # University-wide analytics
│       │   │   └── announcements/page.tsx # Push announcements
│       │   └── layout.tsx
│       ├── components/
│       │   ├── vendor/
│       │   │   ├── OrderCard.tsx
│       │   │   ├── SlotView.tsx
│       │   │   ├── MenuItemForm.tsx
│       │   │   ├── QRScanner.tsx
│       │   │   └── KitchenDisplay.tsx
│       │   ├── admin/
│       │   │   ├── CanteenForm.tsx
│       │   │   ├── VendorForm.tsx
│       │   │   └── AnalyticsCharts.tsx
│       │   └── shared/
│       │       ├── Sidebar.tsx
│       │       ├── Header.tsx
│       │       ├── DataTable.tsx
│       │       └── StatCard.tsx
│       └── package.json
│
├── packages/
│   └── server/                    # Express.js API server
│       ├── src/
│       │   ├── index.ts               # Express app + Socket.IO setup
│       │   ├── config/
│       │   │   ├── database.ts        # Prisma client
│       │   │   ├── redis.ts           # Redis client
│       │   │   ├── firebase.ts        # Firebase Admin SDK
│       │   │   ├── cloudinary.ts      # Cloudinary config
│       │   │   └── razorpay.ts        # Razorpay instance
│       │   ├── middleware/
│       │   │   ├── auth.ts            # JWT verification + role check
│       │   │   ├── rateLimiter.ts
│       │   │   └── errorHandler.ts
│       │   ├── routes/
│       │   │   ├── auth.routes.ts
│       │   │   ├── canteen.routes.ts
│       │   │   ├── menu.routes.ts
│       │   │   ├── order.routes.ts
│       │   │   ├── slot.routes.ts
│       │   │   ├── payment.routes.ts
│       │   │   ├── wallet.routes.ts
│       │   │   ├── analytics.routes.ts
│       │   │   └── admin.routes.ts
│       │   ├── controllers/
│       │   │   ├── auth.controller.ts
│       │   │   ├── canteen.controller.ts
│       │   │   ├── menu.controller.ts
│       │   │   ├── order.controller.ts
│       │   │   ├── slot.controller.ts
│       │   │   ├── payment.controller.ts
│       │   │   ├── wallet.controller.ts
│       │   │   └── analytics.controller.ts
│       │   ├── services/
│       │   │   ├── order.service.ts
│       │   │   ├── slot.service.ts
│       │   │   ├── payment.service.ts
│       │   │   ├── notification.service.ts
│       │   │   ├── qr.service.ts
│       │   │   └── analytics.service.ts
│       │   ├── socket/
│       │   │   └── orderSocket.ts     # Real-time order updates
│       │   └── utils/
│       │       ├── helpers.ts
│       │       └── constants.ts
│       ├── prisma/
│       │   ├── schema.prisma
│       │   └── seed.ts                # Seed data for testing
│       └── package.json
│
├── .env.example
├── docker-compose.yml             # PostgreSQL + Redis for local dev
├── package.json                   # Monorepo root (npm workspaces)
└── README.md
```

---

## 4. Database Schema (Prisma)

Create this file at `packages/server/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================================
// AUTH & USERS
// ============================================================

enum UserRole {
  STUDENT
  VENDOR
  ADMIN
}

model User {
  id              String    @id @default(uuid())
  firebaseUid     String    @unique @map("firebase_uid")
  email           String    @unique
  name            String
  phone           String?
  role            UserRole  @default(STUDENT)
  avatarUrl       String?   @map("avatar_url")
  campus          String?   // "Bannerghatta", "Kengeri", "Central"
  dietPreference  String?   @map("diet_preference") // "veg", "nonveg", "jain", "noegg"
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  // Relations
  wallet          Wallet?
  orders          Order[]
  ratings         Rating[]
  favorites       Favorite[]
  vendorCanteen   Canteen?  @relation("VendorCanteen") // if role=VENDOR, which canteen they manage
  notifications   Notification[]

  @@map("users")
}

// ============================================================
// CANTEENS
// ============================================================

model Canteen {
  id              String    @id @default(uuid())
  name            String    // "Main Canteen", "Food Court", "Juice Corner"
  description     String?
  campus          String    // "Bannerghatta Road", "Kengeri", "Central City"
  location        String?   // "Block 1, Ground Floor"
  imageUrl        String?   @map("image_url")
  bannerUrl       String?   @map("banner_url")
  isActive        Boolean   @default(true) @map("is_active")
  openingTime     String    @map("opening_time") // "07:30"
  closingTime     String    @map("closing_time") // "20:00"
  contactPhone    String?   @map("contact_phone")
  avgPrepTime     Int       @default(15) @map("avg_prep_time") // minutes
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  // Relations
  vendor          User?     @relation("VendorCanteen", fields: [vendorId], references: [id])
  vendorId        String?   @unique @map("vendor_id")
  categories      MenuCategory[]
  menuItems       MenuItem[]
  pickupSlots     PickupSlot[]
  orders          Order[]
  announcements   Announcement[]

  @@map("canteens")
}

// ============================================================
// MENU SYSTEM
// ============================================================

model MenuCategory {
  id              String    @id @default(uuid())
  canteenId       String    @map("canteen_id")
  name            String    // "Breakfast", "Lunch", "Snacks", "Beverages", "South Indian"
  description     String?
  sortOrder       Int       @default(0) @map("sort_order")
  isActive        Boolean   @default(true) @map("is_active")
  availableFrom   String?   @map("available_from") // "07:30" — show this category only during these hours
  availableTo     String?   @map("available_to")   // "10:30"
  createdAt       DateTime  @default(now()) @map("created_at")

  // Relations
  canteen         Canteen   @relation(fields: [canteenId], references: [id], onDelete: Cascade)
  items           MenuItem[]

  @@map("menu_categories")
}

model MenuItem {
  id              String    @id @default(uuid())
  canteenId       String    @map("canteen_id")
  categoryId      String    @map("category_id")
  name            String    // "Masala Dosa"
  description     String?   // "Crispy dosa with potato filling, served with chutney and sambar"
  price           Decimal   @db.Decimal(10, 2)
  imageUrl        String?   @map("image_url")
  isVeg           Boolean   @default(true) @map("is_veg")
  isJain          Boolean   @default(false) @map("is_jain")
  containsEgg     Boolean   @default(false) @map("contains_egg")
  prepTimeMinutes Int       @default(10) @map("prep_time_minutes")
  isAvailable     Boolean   @default(true) @map("is_available") // vendor can toggle this in real-time
  isPopular       Boolean   @default(false) @map("is_popular")
  isNew           Boolean   @default(false) @map("is_new")
  sortOrder       Int       @default(0) @map("sort_order")
  totalOrders     Int       @default(0) @map("total_orders") // for popularity ranking
  avgRating       Decimal   @default(0) @db.Decimal(2, 1) @map("avg_rating")
  totalRatings    Int       @default(0) @map("total_ratings")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  // Customization options (stored as JSON)
  // Example: [{"name": "Spice Level", "options": ["Mild", "Medium", "Spicy"], "type": "single_select"}]
  customizations  Json?     @default("[]")

  // Relations
  canteen         Canteen       @relation(fields: [canteenId], references: [id], onDelete: Cascade)
  category        MenuCategory  @relation(fields: [categoryId], references: [id], onDelete: Cascade)
  orderItems      OrderItem[]
  ratings         Rating[]
  favorites       Favorite[]

  @@index([canteenId, categoryId])
  @@index([canteenId, isAvailable])
  @@map("menu_items")
}

// ============================================================
// PICKUP SLOT SYSTEM (Core Innovation)
// ============================================================

model PickupSlot {
  id              String    @id @default(uuid())
  canteenId       String    @map("canteen_id")
  date            DateTime  @db.Date // "2025-01-15"
  startTime       String    @map("start_time") // "09:00"
  endTime         String    @map("end_time")   // "09:15"
  maxOrders       Int       @map("max_orders") // capacity set by vendor (e.g., 25)
  currentOrders   Int       @default(0) @map("current_orders")
  walkInReserved  Int       @default(5) @map("walk_in_reserved") // slots reserved for walk-ins
  isOpen          Boolean   @default(true) @map("is_open")
  createdAt       DateTime  @default(now()) @map("created_at")

  // Relations
  canteen         Canteen   @relation(fields: [canteenId], references: [id], onDelete: Cascade)
  orders          Order[]

  @@unique([canteenId, date, startTime]) // one slot per canteen per time
  @@index([canteenId, date])
  @@map("pickup_slots")
}

// ============================================================
// ORDERS
// ============================================================

enum OrderStatus {
  PENDING         // just placed, awaiting payment confirmation
  CONFIRMED       // payment received, in queue
  ACCEPTED        // vendor acknowledged
  PREPARING       // kitchen is making it
  READY           // ready for pickup
  PICKED_UP       // student collected (QR scanned)
  CANCELLED       // cancelled by student or vendor
}

enum PaymentStatus {
  PENDING
  PAID
  REFUNDED
  FAILED
}

enum PaymentMethod {
  WALLET
  UPI
  CARD
  CASH
}

model Order {
  id              String        @id @default(uuid())
  orderNumber     String        @unique @map("order_number") // human-readable: "CC-20250115-0042"
  userId          String        @map("user_id")
  canteenId       String        @map("canteen_id")
  slotId          String?       @map("slot_id") // null for walk-in orders
  status          OrderStatus   @default(PENDING)
  paymentStatus   PaymentStatus @default(PENDING) @map("payment_status")
  paymentMethod   PaymentMethod? @map("payment_method")
  subtotal        Decimal       @db.Decimal(10, 2)
  platformFee     Decimal       @default(0) @db.Decimal(10, 2) @map("platform_fee")
  totalAmount     Decimal       @db.Decimal(10, 2) @map("total_amount")
  qrCode          String?       @map("qr_code") // unique QR token
  qrScanned       Boolean       @default(false) @map("qr_scanned")
  specialInstructions String?   @map("special_instructions")
  estimatedReadyAt DateTime?    @map("estimated_ready_at")
  actualReadyAt   DateTime?     @map("actual_ready_at")
  pickedUpAt      DateTime?     @map("picked_up_at")
  cancelledAt     DateTime?     @map("cancelled_at")
  cancelReason    String?       @map("cancel_reason")
  razorpayOrderId String?       @map("razorpay_order_id")
  razorpayPaymentId String?     @map("razorpay_payment_id")
  createdAt       DateTime      @default(now()) @map("created_at")
  updatedAt       DateTime      @updatedAt @map("updated_at")

  // Relations
  user            User          @relation(fields: [userId], references: [id])
  canteen         Canteen       @relation(fields: [canteenId], references: [id])
  slot            PickupSlot?   @relation(fields: [slotId], references: [id])
  items           OrderItem[]
  rating          Rating?
  walletTransaction WalletTransaction?

  @@index([userId, createdAt])
  @@index([canteenId, status])
  @@index([canteenId, slotId])
  @@index([qrCode])
  @@map("orders")
}

model OrderItem {
  id              String    @id @default(uuid())
  orderId         String    @map("order_id")
  menuItemId      String    @map("menu_item_id")
  quantity        Int
  unitPrice       Decimal   @db.Decimal(10, 2) @map("unit_price")
  totalPrice      Decimal   @db.Decimal(10, 2) @map("total_price")
  customizations  Json?     @default("{}") // {"Spice Level": "Mild"}
  notes           String?

  // Relations
  order           Order     @relation(fields: [orderId], references: [id], onDelete: Cascade)
  menuItem        MenuItem  @relation(fields: [menuItemId], references: [id])

  @@map("order_items")
}

// ============================================================
// WALLET & PAYMENTS
// ============================================================

model Wallet {
  id              String    @id @default(uuid())
  userId          String    @unique @map("user_id")
  balance         Decimal   @default(0) @db.Decimal(10, 2)
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  // Relations
  user            User      @relation(fields: [userId], references: [id])
  transactions    WalletTransaction[]

  @@map("wallets")
}

enum TransactionType {
  RECHARGE        // money added to wallet
  DEBIT           // money spent on order
  REFUND          // money returned from cancelled order
}

model WalletTransaction {
  id              String          @id @default(uuid())
  walletId        String          @map("wallet_id")
  orderId         String?         @unique @map("order_id") // linked to order if debit/refund
  type            TransactionType
  amount          Decimal         @db.Decimal(10, 2)
  balanceAfter    Decimal         @db.Decimal(10, 2) @map("balance_after")
  description     String?         // "Recharge via UPI", "Order #CC-20250115-0042"
  razorpayPaymentId String?       @map("razorpay_payment_id")
  createdAt       DateTime        @default(now()) @map("created_at")

  // Relations
  wallet          Wallet          @relation(fields: [walletId], references: [id])
  order           Order?          @relation(fields: [orderId], references: [id])

  @@index([walletId, createdAt])
  @@map("wallet_transactions")
}

// ============================================================
// RATINGS & FAVORITES
// ============================================================

model Rating {
  id              String    @id @default(uuid())
  userId          String    @map("user_id")
  orderId         String    @unique @map("order_id")
  menuItemId      String    @map("menu_item_id")
  rating          Int       // 1-5
  review          String?
  createdAt       DateTime  @default(now()) @map("created_at")

  // Relations
  user            User      @relation(fields: [userId], references: [id])
  order           Order     @relation(fields: [orderId], references: [id])
  menuItem        MenuItem  @relation(fields: [menuItemId], references: [id])

  @@unique([userId, orderId, menuItemId])
  @@map("ratings")
}

model Favorite {
  id              String    @id @default(uuid())
  userId          String    @map("user_id")
  menuItemId      String    @map("menu_item_id")
  createdAt       DateTime  @default(now()) @map("created_at")

  // Relations
  user            User      @relation(fields: [userId], references: [id])
  menuItem        MenuItem  @relation(fields: [menuItemId], references: [id])

  @@unique([userId, menuItemId])
  @@map("favorites")
}

// ============================================================
// NOTIFICATIONS & ANNOUNCEMENTS
// ============================================================

model Notification {
  id              String    @id @default(uuid())
  userId          String    @map("user_id")
  title           String
  body            String
  type            String    // "order_update", "promotion", "announcement"
  data            Json?     @default("{}") // {"orderId": "...", "status": "READY"}
  isRead          Boolean   @default(false) @map("is_read")
  createdAt       DateTime  @default(now()) @map("created_at")

  // Relations
  user            User      @relation(fields: [userId], references: [id])

  @@index([userId, isRead])
  @@map("notifications")
}

model Announcement {
  id              String    @id @default(uuid())
  canteenId       String?   @map("canteen_id") // null = broadcast to all
  title           String
  body            String
  isActive        Boolean   @default(true) @map("is_active")
  startsAt        DateTime  @map("starts_at")
  endsAt          DateTime? @map("ends_at")
  createdAt       DateTime  @default(now()) @map("created_at")

  // Relations
  canteen         Canteen?  @relation(fields: [canteenId], references: [id])

  @@map("announcements")
}
```

---

## 5. API Endpoints

### Authentication
```
POST   /api/auth/register          — Register with email/password + role
POST   /api/auth/login             — Login, returns JWT
POST   /api/auth/google            — Google OAuth sign-in
GET    /api/auth/me                — Get current user profile
PUT    /api/auth/me                — Update profile (name, phone, diet preference, campus)
POST   /api/auth/fcm-token         — Save FCM token for push notifications
```

### Canteens
```
GET    /api/canteens                           — List all active canteens (filterable by campus)
GET    /api/canteens/:id                       — Get canteen details
POST   /api/admin/canteens                     — [ADMIN] Create canteen
PUT    /api/admin/canteens/:id                 — [ADMIN] Update canteen
DELETE /api/admin/canteens/:id                 — [ADMIN] Deactivate canteen
GET    /api/canteens/:id/live-stats            — Live: current queue count, avg wait time
```

### Menu Management
```
GET    /api/canteens/:id/menu                  — Full menu: categories with items (for student app)
GET    /api/canteens/:id/menu/search?q=dosa    — Search items in this canteen
GET    /api/menu/search?q=dosa                 — Search across ALL canteens

POST   /api/vendor/categories                  — [VENDOR] Create category for their canteen
PUT    /api/vendor/categories/:id              — [VENDOR] Update category
DELETE /api/vendor/categories/:id              — [VENDOR] Delete category

POST   /api/vendor/items                       — [VENDOR] Create menu item
PUT    /api/vendor/items/:id                   — [VENDOR] Update menu item
PATCH  /api/vendor/items/:id/availability      — [VENDOR] Toggle available/sold-out (single tap)
DELETE /api/vendor/items/:id                   — [VENDOR] Remove item
POST   /api/vendor/items/:id/image             — [VENDOR] Upload item image (multipart)
```

### Pickup Slots
```
GET    /api/canteens/:id/slots?date=2025-01-15 — Available slots for a canteen on a date
POST   /api/vendor/slots/generate              — [VENDOR] Auto-generate slots for a date range
PUT    /api/vendor/slots/:id                   — [VENDOR] Adjust slot capacity
PATCH  /api/vendor/slots/:id/toggle            — [VENDOR] Open/close a slot
```

### Orders
```
POST   /api/orders                             — Place new order (with items, slot, payment method)
GET    /api/orders                             — [STUDENT] My order history (paginated)
GET    /api/orders/:id                         — Order details + real-time status
GET    /api/orders/:id/qr                      — Get QR code for pickup
POST   /api/orders/:id/cancel                  — Cancel order (within allowed window)

GET    /api/vendor/orders?date=&slot=&status=   — [VENDOR] Orders for their canteen (filterable)
PATCH  /api/vendor/orders/:id/status            — [VENDOR] Update status (ACCEPTED→PREPARING→READY)
POST   /api/vendor/orders/:id/scan              — [VENDOR] Scan QR to mark as PICKED_UP
GET    /api/vendor/orders/prep-sheet?date=       — [VENDOR] Aggregated prep quantities by slot
```

### Wallet & Payments
```
GET    /api/wallet                             — Get wallet balance
GET    /api/wallet/transactions                — Transaction history (paginated)
POST   /api/wallet/recharge                    — Initiate recharge (creates Razorpay order)
POST   /api/wallet/recharge/verify             — Verify Razorpay payment + credit wallet
POST   /api/payments/create-order              — Direct payment (non-wallet) via Razorpay
POST   /api/payments/verify                    — Verify direct payment
```

### Ratings & Favorites
```
POST   /api/orders/:id/rate                    — Rate an order (per item)
GET    /api/favorites                          — List my favorite items
POST   /api/favorites/:menuItemId              — Add to favorites
DELETE /api/favorites/:menuItemId              — Remove from favorites
```

### Analytics
```
GET    /api/vendor/analytics/summary?period=    — [VENDOR] Sales summary (today/week/month)
GET    /api/vendor/analytics/popular-items       — [VENDOR] Top selling items
GET    /api/vendor/analytics/peak-hours          — [VENDOR] Order distribution by hour
GET    /api/vendor/analytics/prep-performance    — [VENDOR] Avg prep time vs estimated

GET    /api/admin/analytics/overview             — [ADMIN] Cross-canteen summary
GET    /api/admin/analytics/canteen-comparison   — [ADMIN] Compare revenue, ratings, speed
GET    /api/admin/analytics/student-satisfaction  — [ADMIN] Ratings & complaint trends
```

### Notifications & Announcements
```
GET    /api/notifications                       — My notifications (paginated)
PATCH  /api/notifications/:id/read              — Mark as read
PATCH  /api/notifications/read-all              — Mark all as read

POST   /api/admin/announcements                 — [ADMIN] Create announcement
GET    /api/announcements                       — Active announcements for student
```

---

## 6. Core Business Logic

### 6.1 Slot Engine Logic

```typescript
// packages/server/src/services/slot.service.ts

/*
SLOT GENERATION RULES:
- Vendor defines slot duration (default: 15 min), max orders per slot, walk-in reserve percentage
- Slots are auto-generated for the next 7 days every midnight via cron job
- Each slot has: maxOrders (total capacity), walkInReserved (30% default), so pre-order capacity = maxOrders - walkInReserved
- Slots are per-canteen — each canteen manages its own capacity independently

BOOKING RULES:
- Students can book up to 12 hours in advance (night before for breakfast)
- Cut-off: no new pre-orders within 10 minutes of slot start time
- If a slot's pre-order capacity is full, show "Full" but still allow walk-in at counter
- Auto-cancel unpaid orders after 5 minutes, releasing the slot back
- When an order is cancelled, decrement currentOrders and open the slot back up

SLOT AVAILABILITY RESPONSE:
{
  slotId: "...",
  startTime: "09:00",
  endTime: "09:15",
  totalCapacity: 25,
  preOrderCapacity: 18,   // 25 - 7 walk-in reserved
  booked: 12,
  available: 6,            // 18 - 12
  fillPercentage: 67,      // (12/18)*100
  isFull: false,
  isOpen: true
}
*/
```

### 6.2 Order Flow

```
STUDENT PLACES ORDER:
1. Student adds items to cart (validated: items belong to same canteen, all available)
2. Student selects pickup slot (validated: slot exists, not full, not past cut-off)
3. Student selects payment method (wallet / UPI / card)
4. Backend creates Order with status=PENDING, increments slot.currentOrders
5. If wallet: deduct immediately, set paymentStatus=PAID, status=CONFIRMED
6. If UPI/card: create Razorpay order, wait for payment callback
7. On payment success: set paymentStatus=PAID, status=CONFIRMED
8. If payment fails/times out (5 min): cancel order, decrement slot, refund if needed
9. Generate unique QR code token (JWT with orderId + userId + expiry, signed with secret)
10. Send push notification: "Order #CC-001 confirmed! Pickup at 9:15 AM"

VENDOR PROCESSES ORDER:
1. Vendor dashboard shows orders grouped by slot
2. 10 min before slot: prep sheet auto-generated ("15 dosas, 8 idlis, 5 coffees for 9:15 slot")
3. Vendor taps "Accept" → status=ACCEPTED, student notified
4. Vendor taps "Preparing" → status=PREPARING, student sees live progress
5. Vendor taps "Ready" → status=READY, student gets push: "Your order is ready! Show QR at counter"
6. Student shows QR → vendor scans → validates (correct order, not already scanned, not expired)
7. On successful scan → status=PICKED_UP, QR invalidated

CANCELLATION RULES:
- Student can cancel if status is PENDING or CONFIRMED (before ACCEPTED)
- Once ACCEPTED/PREPARING: no student cancellation (vendor already cooking)
- Vendor can cancel any time before READY (item unavailable, kitchen issue)
- On cancellation: slot.currentOrders decremented, wallet refunded automatically, UPI/card refund via Razorpay
```

### 6.3 QR Code System

```typescript
// QR Token Structure (JWT):
{
  orderId: "uuid",
  userId: "uuid",
  orderNumber: "CC-20250115-0042",
  canteenId: "uuid",
  iat: 1705300000,
  exp: 1705350000  // expires 12 hours after order creation
}

// On scan:
// 1. Verify JWT signature
// 2. Check order exists and belongs to this canteen
// 3. Check order.status === "READY" (can't pick up if not ready yet)
// 4. Check order.qrScanned === false (prevent double pickup)
// 5. If all pass: mark PICKED_UP, set qrScanned=true, record pickedUpAt timestamp
// 6. If any fail: show error to vendor ("Order not ready yet" / "Already collected" / "Invalid QR")
```

### 6.4 Real-time Updates (Socket.IO)

```typescript
// Rooms:
// - `order:{orderId}` — student joins to track their specific order
// - `canteen:{canteenId}` — vendor joins to get all order updates for their canteen
// - `slot:{slotId}` — broadcast slot availability changes

// Events:
// Server → Client:
//   "order:status_update"   { orderId, status, estimatedReadyAt }
//   "order:new"             { order } (to vendor)
//   "slot:availability"     { slotId, currentOrders, available }
//   "item:availability"     { menuItemId, isAvailable } (real-time sold out)

// Client → Server:
//   "join:order"            { orderId }
//   "join:canteen"          { canteenId }
//   "leave:order"           { orderId }
```

### 6.5 Wallet System

```typescript
// RECHARGE FLOW:
// 1. Student requests recharge of ₹X
// 2. Backend creates Razorpay order for ₹X
// 3. Student completes payment on Razorpay checkout
// 4. Razorpay webhook/callback hits /api/wallet/recharge/verify
// 5. Verify signature, credit wallet, create WalletTransaction(type=RECHARGE)

// DEBIT FLOW (on order placement):
// 1. Check wallet.balance >= order.totalAmount
// 2. If insufficient: return error "Insufficient balance, please recharge"
// 3. Deduct amount atomically (use Prisma transaction)
// 4. Create WalletTransaction(type=DEBIT, orderId=...)

// REFUND FLOW (on cancellation):
// 1. If original paymentMethod was WALLET: credit back to wallet
// 2. Create WalletTransaction(type=REFUND, orderId=...)
// 3. If UPI/card: initiate Razorpay refund API call
```

---

## 7. Mobile App Screens (React Native / Expo)

### Screen Flow
```
Splash → Login/Register → Home (Tab Navigator)
                                ├── Home Tab
                                │   ├── Canteen List (cards with campus filter)
                                │   ├── → Canteen Menu Screen (categories + items)
                                │   ├── → Item Detail Modal (description, customize, add to cart)
                                │   ├── → Cart Screen (review items, adjust quantities)
                                │   └── → Checkout Screen (select slot, choose payment, confirm)
                                │       └── → Order Confirmed (QR code + tracking)
                                ├── Orders Tab
                                │   ├── Active Orders (live tracking, QR display)
                                │   └── Past Orders (history, reorder button, rate)
                                ├── Wallet Tab
                                │   ├── Balance + Recharge Button
                                │   └── Transaction History
                                └── Profile Tab
                                    ├── Edit Profile
                                    ├── Diet Preferences
                                    ├── Favorites
                                    ├── Notifications
                                    └── Support / Feedback
```

### Key Component Specs

**Home Screen — Canteen List:**
- Campus filter chips at top: "All", "Bannerghatta", "Kengeri", "Central" (highlight current campus based on user profile)
- Search bar: "Search for dosa, coffee, biryani..." — searches across all canteens
- Canteen cards: banner image, name, location, "Open now" green badge or "Closed" red badge, live queue count ("12 orders ahead"), estimated wait time, star rating
- Tap card → navigate to canteen menu

**Canteen Menu Screen:**
- Canteen banner at top with name, location, hours
- Category tabs (horizontal scroll): auto-highlight based on time of day (breakfast tabs at morning, lunch tabs at noon)
- "Popular" section at very top showing top 5 ordered items from this canteen
- Each menu item card: image thumbnail, name, price (₹), veg/non-veg indicator (green/red dot), prep time, add-to-cart button (+/- stepper if already in cart), "Sold out" overlay if unavailable
- Sticky cart bar at bottom: "3 items — ₹180 — View Cart →"

**Slot Picker (in Checkout):**
- Date selector: today / tomorrow
- Time slot grid: each slot shows time range + fill bar + "X of Y available"
- Full slots greyed out, nearly full slots in amber, open slots in green
- Below slots: total order summary + payment method selector (Wallet balance shown, UPI, Card)

**Order Tracking Screen:**
- Order number + canteen name at top
- Status stepper: Confirmed → Accepted → Preparing → Ready → Picked Up (current step highlighted, animated)
- Estimated time countdown: "Ready in ~8 minutes"
- QR code (large, scannable) — appears prominently when status = READY
- Pull-to-refresh for manual update, but primary updates via Socket.IO

---

## 8. Vendor Dashboard Screens (Next.js)

### Pages

**Dashboard (Landing):**
- Today's summary cards: total orders, revenue, avg prep time, active orders
- Live order feed: real-time new orders appearing
- Quick actions: "Mark all 9:15 orders as Preparing"

**Orders Page:**
- Filter bar: date picker, slot dropdown, status filter
- Kanban-style columns: Incoming | Preparing | Ready | Picked Up
- Or: list view grouped by slot ("9:00 AM Slot — 18 orders", "9:15 AM Slot — 22 orders")
- Each order card: order number, student name, items list, total, time since placed
- One-tap status buttons: "Accept" → "Start Preparing" → "Mark Ready"
- Click order for full details + special instructions

**Prep Sheet View:**
- Select a slot → see aggregated quantities: "Masala Dosa × 15, Plain Dosa × 8, Filter Coffee × 22"
- Printable format for kitchen staff

**Menu Management:**
- List all categories (drag to reorder)
- Under each category: list items with toggle switches for availability
- Add/edit item form: name, description, price, category, prep time, veg/non-veg, image upload, customization options builder
- Bulk actions: "Mark all breakfast items as unavailable" (after breakfast hours)

**QR Scanner:**
- Opens device camera
- Scans QR → shows order details overlay → "Hand Over" confirmation button
- Success: green checkmark animation
- Error: red alert with reason ("Already collected", "Order not ready", "Wrong canteen")

**Analytics:**
- Revenue chart (daily/weekly/monthly line chart)
- Popular items bar chart (top 10)
- Peak hours heatmap
- Avg prep time trend
- Customer satisfaction (avg rating trend)

---

## 9. Admin Panel Screens (Next.js)

**Dashboard:**
- All canteens overview: total orders today, total revenue, system health
- Alert panel: canteens with high wait times, unresolved complaints

**Canteen Management:**
- List all canteens with status toggle (active/inactive)
- Add/edit canteen: name, campus, location, hours, banner image, assign vendor
- View per-canteen stats

**Vendor Management:**
- List vendor accounts
- Create vendor account → assign to canteen
- Reset password, deactivate account

**Analytics:**
- Canteen comparison table: orders, revenue, avg rating, avg wait time
- Student satisfaction trends
- Campus-wise breakdown

**Announcements:**
- Create announcement: title, body, target (all students / specific canteen / specific campus)
- Schedule: start date, end date
- Active announcements list with toggle

---

## 10. Environment Variables

```env
# .env.example

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/christ_canteen

# Redis
REDIS_URL=redis://localhost:6379

# Firebase
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com

# Razorpay
RAZORPAY_KEY_ID=rzp_test_xxxxx
RAZORPAY_KEY_SECRET=xxxxx

# Cloudinary
CLOUDINARY_CLOUD_NAME=your-cloud
CLOUDINARY_API_KEY=xxxxx
CLOUDINARY_API_SECRET=xxxxx

# JWT
JWT_SECRET=your-super-secret-key-for-qr-tokens
JWT_EXPIRES_IN=12h

# App
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000,http://localhost:8081

# Notifications
FCM_SERVER_KEY=xxxxx
```

---

## 11. Docker Compose (Local Development)

```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: christ_canteen
      POSTGRES_USER: canteen_user
      POSTGRES_PASSWORD: canteen_pass
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  pgdata:
```

---

## 12. Seed Data

```typescript
// packages/server/prisma/seed.ts
// Run with: npx prisma db seed

/*
SEED THE FOLLOWING:

1. CANTEENS (create 5 real Christ University canteens):
   - "Main Canteen" — Bannerghatta Road campus, Block 1 Ground Floor, 07:30-20:00
   - "Food Court" — Bannerghatta Road campus, New Block, 08:00-19:00
   - "Juice & Snack Corner" — Bannerghatta Road campus, Near Library, 08:00-18:00
   - "Kengeri Campus Canteen" — Kengeri campus, Main Building, 07:30-19:00
   - "Central City Cafeteria" — Central City campus, 08:00-17:00

2. CATEGORIES per canteen (example for Main Canteen):
   - "Breakfast" (available 07:30-10:30)
   - "Lunch" (available 12:00-14:30)
   - "Snacks" (available 15:00-18:00)
   - "Beverages" (available 07:30-20:00, all day)
   - "South Indian Special" (available 07:30-10:30)

3. MENU ITEMS per category (example for Main Canteen > Breakfast):
   - Masala Dosa — ₹50, veg, 8 min prep, image placeholder
   - Plain Dosa — ₹35, veg, 6 min
   - Idli Sambar (2 pcs) — ₹30, veg, 5 min
   - Vada (2 pcs) — ₹30, veg, 5 min
   - Poha — ₹25, veg, 5 min
   - Upma — ₹25, veg, 5 min
   - Bread Omelette — ₹40, non-veg, contains egg, 7 min
   - Aloo Paratha — ₹45, veg, 10 min
   - Filter Coffee — ₹20, veg, 3 min (also in Beverages)
   - Chai — ₹15, veg, 3 min (also in Beverages)

   For Lunch:
   - Meals (Rice + 2 Sabzi + Dal + Roti + Curd) — ₹80, veg, 5 min
   - Non-Veg Meals — ₹100, non-veg, 5 min
   - Chicken Biryani — ₹120, non-veg, 12 min
   - Veg Biryani — ₹80, veg, 10 min
   - Paneer Butter Masala + Roti — ₹90, veg, 10 min
   - Egg Fried Rice — ₹60, non-veg, 8 min
   - Curd Rice — ₹40, veg, 3 min

   (Generate similar items for other canteens with DIFFERENT menus and DIFFERENT prices.
    Food Court should have: burgers, wraps, pasta, pizza, sandwiches.
    Juice Corner should have: fresh juices, smoothies, shakes, cookies, sandwiches.)

4. PICKUP SLOTS (generate for today and next 3 days):
   - Main Canteen breakfast: 08:00, 08:15, 08:30, 08:45, 09:00, 09:15, 09:30, 09:45, 10:00 — 25 max each
   - Main Canteen lunch: 12:00, 12:15, 12:30, 12:45, 13:00, 13:15, 13:30 — 30 max each
   - (Similar for other canteens with appropriate times and capacities)

5. TEST USERS:
   - student@test.com (role: STUDENT, name: "Test Student", campus: "Bannerghatta Road")
   - vendor@test.com (role: VENDOR, name: "Main Canteen Vendor", assigned to Main Canteen)
   - admin@test.com (role: ADMIN, name: "University Admin")
   - Create wallets for student with ₹500 balance

6. SAMPLE ORDERS (5-10 past orders for the test student):
   - Mix of statuses: PICKED_UP, READY, PREPARING
   - Spread across different canteens
   - Include ratings for PICKED_UP orders
*/
```

---

## 13. Implementation Order (Step-by-Step for Claude Code)

Follow this exact sequence. Each step should be fully working before moving to the next.

### Step 1: Project Setup
1. Initialize monorepo with npm workspaces
2. Set up `packages/server` with Express + TypeScript + Prisma
3. Set up `apps/web` with Next.js 14 + Tailwind
4. Set up `apps/mobile` with Expo + TypeScript
5. Create `docker-compose.yml` for PostgreSQL + Redis
6. Create `.env.example` and `.env` files
7. Run `docker compose up -d` and verify DB connection

### Step 2: Database & Auth
1. Create the full Prisma schema (copy from Section 4 above)
2. Run `npx prisma migrate dev --name init`
3. Set up Firebase Admin SDK in server
4. Create auth middleware (verify Firebase token → find/create user → attach to req)
5. Create auth routes (register, login, me, update profile)
6. Create seed file and run it
7. Test all auth endpoints with Postman/Thunder Client

### Step 3: Canteen & Menu APIs
1. Create canteen CRUD routes (admin creates, all users read)
2. Create menu category CRUD (vendor manages their canteen's categories)
3. Create menu item CRUD (vendor manages items)
4. Create the `GET /canteens/:id/menu` endpoint that returns the full nested menu
5. Create search endpoint across canteens
6. Create availability toggle endpoint
7. Set up Cloudinary for image uploads
8. Test all menu endpoints

### Step 4: Slot System
1. Create slot generation logic (auto-generate for date range)
2. Create slot availability query endpoint
3. Create cron job for nightly slot generation (next 7 days)
4. Implement slot capacity validation (check pre-order vs walk-in reserve)
5. Redis caching for slot availability (cache current counts, invalidate on order)
6. Test slot endpoints

### Step 5: Order System
1. Create order placement endpoint (validate items, slot, calculate totals)
2. Generate order number (format: CC-YYYYMMDD-XXXX)
3. Generate QR code token (JWT)
4. Create order status update endpoint (vendor)
5. Create QR scan/validation endpoint
6. Create cancellation logic with slot release
7. Set up Socket.IO for real-time updates
8. Create auto-cancel cron for unpaid orders (5 min timeout)
9. Test full order lifecycle

### Step 6: Wallet & Payments
1. Create wallet model and auto-create on user registration
2. Integrate Razorpay SDK
3. Create recharge flow (create Razorpay order → verify payment → credit wallet)
4. Create wallet debit flow (atomic transaction on order placement)
5. Create refund flow (cancel → credit back)
6. Create transaction history endpoint
7. Test payment flows with Razorpay test mode

### Step 7: Notifications
1. Set up FCM in server
2. Create notification service (send push + store in DB)
3. Hook notifications into order status changes
4. Create notification list/read endpoints
5. Implement announcement system
6. Test push notifications on real device

### Step 8: Mobile App — Auth & Navigation
1. Set up Expo Router with tab navigation
2. Create login/register screens with Firebase Auth
3. Set up Zustand stores (auth, cart, orders)
4. Create API service layer with Axios + auth interceptor
5. Protected routes (redirect to login if not authenticated)
6. Test auth flow on device/simulator

### Step 9: Mobile App — Canteen & Menu
1. Home screen: canteen cards with campus filter
2. Search bar with cross-canteen search
3. Canteen menu screen with category tabs
4. Menu item cards with add-to-cart functionality
5. Item detail modal with customization
6. Cart screen with quantity adjusters
7. Diet filter (veg/jain/no-egg) persisted in profile
8. Test browsing and cart flow

### Step 10: Mobile App — Checkout & Orders
1. Checkout screen: slot picker component
2. Payment method selection (wallet balance shown)
3. Razorpay checkout integration for UPI/card
4. Order confirmation screen with QR code
5. Order tracking screen with Socket.IO status updates
6. Order history with reorder functionality
7. Test full ordering flow end-to-end

### Step 11: Mobile App — Wallet & Extras
1. Wallet screen: balance, recharge, transaction history
2. Favorites functionality
3. Rating/review modal after pickup
4. Notification list screen
5. Profile editing with diet preferences
6. Pull-to-refresh on all list screens

### Step 12: Vendor Dashboard
1. Auth with role-based redirect
2. Dashboard: today's stats + live order feed
3. Orders page: slot-wise grouping + status management
4. Prep sheet view: aggregated quantities per slot
5. Menu management: CRUD categories + items + image upload + availability toggle
6. QR scanner using browser camera API (html5-qrcode library)
7. Analytics page with charts (use Recharts or Chart.js)
8. Test vendor workflow end-to-end

### Step 13: Admin Panel
1. Canteen management (CRUD + vendor assignment)
2. Vendor account management
3. Cross-canteen analytics dashboard
4. Announcement management
5. Test admin workflow

### Step 14: Polish & Production
1. Add loading skeletons to all screens
2. Add error handling and retry logic everywhere
3. Offline-first: cache canteen list and menu locally
4. Add rate limiting on API
5. Add input validation (Zod) on all endpoints
6. Security: parameterized queries (Prisma handles this), CORS, helmet
7. Performance: add database indexes (already in schema), optimize queries
8. Create production Dockerfiles
9. Set up CI/CD with GitHub Actions
10. Deploy backend to Railway/Render, web to Vercel, mobile to Expo EAS

---

## 14. Key Technical Decisions & Notes

### Multi-canteen menu architecture
Each canteen is a completely independent entity. `menu_categories` and `menu_items` are scoped by `canteen_id`. When a vendor logs in, the middleware checks their `vendorCanteen` relation and scopes ALL their queries to that canteen. They literally cannot see or modify another canteen's data.

### How to handle the "same item, different canteen" problem
Items are NOT shared across canteens. If both Main Canteen and Food Court serve "Filter Coffee", these are two separate `MenuItem` records with potentially different prices, descriptions, and images. This is intentional — each canteen operates independently and should control their own menu. The cross-canteen search (`/api/menu/search`) queries all canteens and returns results grouped by canteen, so students can compare prices.

### Slot capacity algorithm
```
preOrderCapacity = maxOrders - walkInReserved
available = preOrderCapacity - currentOrders
isFull = available <= 0
```
The `walkInReserved` ensures we don't fully pre-book the kitchen — walk-in students still need to eat. Default is 30% reserved for walk-ins, but vendors can adjust per slot.

### Order number format
`{CAMPUS_CODE}-{YYYYMMDD}-{SEQUENTIAL_NUMBER}`
Example: `CC-20250115-0042` (CC = Christ Campus, 42nd order of the day)
The sequential number resets daily. Use a Redis INCR key `order_seq:{date}` for atomic incrementing.

### QR code security
QR contains a JWT, not just the order ID. This prevents:
- Forging a QR by guessing order IDs
- Reusing a QR (JWT has `exp`, and `qrScanned` flag in DB)
- Cross-canteen misuse (JWT includes `canteenId`, validated on scan)

### Why wallet over direct UPI every time
UPI at the counter adds 30-60 seconds per transaction (open app, scan, wait for confirmation). With 100+ students in the morning, that's 50-100 minutes of collective waiting. Wallet deduction is instant (200ms database transaction). Encourage wallet adoption by showing "Wallet: 0.5s" vs "UPI: ~30s" in checkout.

### Real-time architecture
- Socket.IO is used for low-latency order status updates (student tracking + vendor new orders)
- Redis Pub/Sub backs Socket.IO for multi-instance scalability
- Menu availability changes (sold out) broadcast via Socket.IO to all connected students viewing that canteen
- Slot availability updates broadcast when orders are placed/cancelled

### Mobile-first design
The student app is the primary interface. Design all API responses to be mobile-friendly:
- Paginate everything (20 items per page)
- Include image URLs as CDN links (Cloudinary transforms for thumbnails)
- Cache-friendly headers on menu endpoints (ETag, Cache-Control)
- Minimal response payloads (don't return full relations unless needed)

---

## 15. Testing Checklist

Before launch, verify these critical flows:

- [ ] Student registers → sees canteens → browses menu → adds to cart → selects slot → pays via wallet → gets QR → shows QR → order marked picked up
- [ ] Student registers → recharges wallet via UPI → balance updates → uses wallet to order
- [ ] Student cancels order before vendor accepts → slot released, wallet refunded
- [ ] Vendor marks item as sold out → student app shows "Sold out" in real-time
- [ ] Vendor accepts → prepares → marks ready → student gets push notification
- [ ] Vendor scans QR → order marked picked up → QR becomes invalid on second scan
- [ ] Slot fills up → students see "Full" → can pick next available slot
- [ ] Admin creates new canteen → assigns vendor → vendor logs in and sees their canteen only
- [ ] Search "dosa" → results from multiple canteens with prices
- [ ] 50 concurrent orders in same slot → system handles without race conditions (Redis locking)
- [ ] WiFi drops during order → graceful error, no double charges
- [ ] Payment fails → order auto-cancelled after 5 min → slot released

---

*End of specification. This document contains everything needed to build the Christ University Virtual Canteen System from scratch. Feed this to Claude Code and build it step by step following Section 13.*
