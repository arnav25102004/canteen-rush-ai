# Canteen Rush AI — How to Run Everything

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Python | 3.10+ | `python --version` |
| Node.js | 18+ | `node --version` |
| Docker Desktop | any | Must be running |
| Expo Go (Android) | latest | Install from Play Store |

---

## Step 1 — Start Docker (MongoDB)

Open Docker Desktop and make sure it is running.
Then in any terminal:

```bash
cd M:\canteen-rush-ai
docker-compose up -d
```

This starts MongoDB on port 27017. You only need to do this once per session.

Verify it is running:
```bash
docker ps
# Should show: christ_canteen_mongo   Up
```

---

## Step 2 — Backend (FastAPI, port 8000)

```bash
cd M:\canteen-rush-ai\backend
pip install -r requirements.txt
```

**First time only — seed the menu:**
```bash
python seed_menu.py
# Output: Success! Menu added to MongoDB.
```

**Start the server:**
```bash
python main.py
# Output: Uvicorn running on http://0.0.0.0:8000
```

Leave this terminal open. The backend must be running for the app to work.

API docs available at: http://localhost:8000/docs

---

## Step 3 — Mobile App (Expo Go)

Open a **new terminal**:

```bash
cd M:\canteen-rush-ai\apps\mobile
```

**First time only — install packages:**
```bash
npm install --legacy-peer-deps
```

**Start Expo with tunnel** (works on any network including university WiFi):
```powershell
$env:NODE_OPTIONS="--max-old-space-size=4096"; npx expo start --tunnel -c
```

- Scan the QR code with **Expo Go** on your Android phone
- The `-c` flag clears Metro cache (use it if you see stale errors)
- Remove `--tunnel` if you are on home WiFi and it is slow

**First time setup in the app:**
1. Tap **Register** and create an account
2. You will land on the Canteens home screen
3. Go to **Wallet** tab → tap **+ Recharge** → add ₹200 or more
4. Now you can browse the menu and place orders

---

## Step 4 — Vendor Dashboard (Kitchen Display, port 3000)

Open a **new terminal**:

```bash
cd M:\canteen-rush-ai\vendor-dashboard
npm install
npm start
# Opens http://localhost:3000 in your browser
```

This is the kitchen screen. When a student places an order it appears here.
Click **Ready for Pickup** to move the order to READY status.
The mobile app polls every 5 seconds and updates automatically.

---

## Full Order Flow

```
Student (Expo Go)          Backend (FastAPI)        Vendor (localhost:3000)
──────────────────         ─────────────────        ───────────────────────
Register / Login      →    POST /register|login
Browse canteen        →    GET /canteens + /menu
Add items to cart
Recharge wallet       →    POST /wallet/recharge
Checkout              →    POST /orders
Order Tracking screen ←    GET /orders/{id}  (polls every 5s)
                                                     Order card appears
                                                     Click "Ready for Pickup"
                           status → READY
Order shows READY ✅  ←    GET /orders/{id}
```

---

## Environment Variables

Copy `.env.example` to `apps/mobile/.env` and set your laptop's IP:

```bash
# Run this to find your IP:
ipconfig    # Windows — look for "IPv4 Address" under your WiFi adapter

# Edit apps/mobile/.env:
EXPO_PUBLIC_API_URL=http://<YOUR_IP>:8000
```

> If using `--tunnel` mode this IP is not used (tunnel routes all traffic).
> If on same WiFi without tunnel, the phone must reach this IP on port 8000.

---

## Port Reference

| Service | Port | Command |
|---------|------|---------|
| FastAPI backend | 8000 | `python main.py` in `backend/` |
| Expo Metro | 8081 | `npx expo start` in `apps/mobile/` |
| Vendor Dashboard | 3000 | `npm start` in `vendor-dashboard/` |
| MongoDB | 27017 | Docker (`docker-compose up -d`) |

---

## Common Errors

| Error | Fix |
|-------|-----|
| `500` on register/login | Backend not running → `python main.py` |
| Menu is empty | Run `python seed_menu.py` once |
| App stuck on splash | Stop Metro, run `npx expo start --tunnel -c` |
| `ENOENT watch` crash | npm install ran while Metro was open — restart Metro |
| Order items blank in vendor dashboard | Restart backend after latest pull |
| Wallet balance not updating | Backend was not restarted after `database.py` change |
