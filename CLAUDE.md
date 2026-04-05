# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Canteen Rush AI** is a university cafeteria management system with three active components:
- **backend/** — Python FastAPI REST API (port 8000)
- **vendor-dashboard/** — React Kitchen Display System (port 3000)
- **ml_service/** — Scikit-learn ETA prediction service (port 8001)
- **ChristEats/** — Android customer app (Kotlin/Compose, in development)

MongoDB runs locally at `mongodb://localhost:27017` with `menu` and `orders` collections.

## Running the Project

### Backend
```bash
cd backend
pip install -r requirements.txt
python seed_menu.py        # one-time: seed menu items into MongoDB
python main.py             # starts FastAPI on :8000
```

### Vendor Dashboard (React)
```bash
cd vendor-dashboard
npm install
npm start                  # dev server on :3000
npm run build              # production build
npm test                   # run tests
```

### ML Service
```bash
cd ml_service
python train_model.py      # trains model, saves to ../model/queue_model.pkl
python predict.py          # starts prediction API on :8001
```

### Android App
```bash
cd ChristEats/ChristEats
./gradlew build
```

## Architecture

### Data Flow
1. Customer places order via Android app → `POST /order`
2. Backend calculates prep time, calls ML model for ETA prediction, saves to MongoDB
3. Vendor Dashboard polls `GET /queue` every 3 seconds to display active orders
4. Vendor clicks "Mark Ready" → `POST /update_status/{order_id}?status=ready`
5. Customer picks up with token → `POST /pickup`

### Order Lifecycle
`ordered` → `preparing` → `ready` → `collected`

### ML Model
- RandomForestRegressor loaded from `../model/queue_model.pkl` at backend startup
- Input features: `[prep_time, active_orders, vendor_capacity, time_of_day, rush_factor]`
- Output: predicted wait time in minutes
- Model is loaded inline in `backend/main.py` (not via the separate ml_service)

### Backend Key Files
- [backend/main.py](backend/main.py) — All API routes and core logic
- [backend/models.py](backend/models.py) — Pydantic models (MenuItem, OrderItem, Order)
- [backend/database.py](backend/database.py) — MongoDB connection via Motor (async)
- [backend/token_utils.py](backend/token_utils.py) — Token generation for pickup verification

### Frontend Key Files
- [vendor-dashboard/src/App.js](vendor-dashboard/src/App.js) — Entire KDS UI (~220 lines, single component)
- Polls backend, displays color-coded order cards (yellow=ordered, blue=preparing, green=ready)

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/menu` | All menu items |
| POST | `/order` | Place order (triggers ETA prediction) |
| GET | `/queue` | Active orders for vendor dashboard |
| POST | `/update_status/{order_id}?status=<status>` | Update order state |
| POST | `/pickup` | Verify token and mark collected |
| POST | `/predict` (ml_service) | Direct ETA prediction |

## Dependencies & Ports

| Service | Port | Dependency |
|---------|------|------------|
| FastAPI backend | 8000 | MongoDB on 27017, model/queue_model.pkl |
| React vendor dashboard | 3000 | Backend on 8000 |
| ML predict service | 8001 | model/queue_model.pkl |
| MongoDB | 27017 | — |