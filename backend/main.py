import sys
import os

# --- FIX 1: Add the current folder to Python's path so it finds 'database.py' ---
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from database import menu_collection, order_collection, user_collection, wallet_collection
from models import Order
from token_utils import generate_token, validate_token
from bson import ObjectId
from passlib.context import CryptContext
import joblib
import numpy as np
from datetime import datetime, timedelta

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

app = FastAPI()

# --- CORS (Allow All) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- LOAD THE AI MODEL ---
try:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    # --- FIX 2: Look in the PARENT folder for ml_service (..) ---
    MODEL_PATH = os.path.join(BASE_DIR, "..", "ml_service", "model", "queue_model.pkl")
    ai_model = joblib.load(MODEL_PATH)
    print("AI Model Loaded Successfully!")
except Exception as e:
    print(f"Warning: AI Model not found. Using simple math. Error: {e}")
    ai_model = None

# --- AUTH: REGISTER ---
@app.post("/register")
async def register(body: dict):
    name = body.get("name", "").strip()
    email = body.get("email", "").strip().lower()
    password = body.get("password", "")

    if not name or not email or not password:
        raise HTTPException(status_code=400, detail="name, email and password are required")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    existing = await user_collection.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="An account with this email already exists")

    hashed = pwd_context.hash(password)
    result = await user_collection.insert_one({
        "name": name,
        "email": email,
        "password": hashed,
        "role": "student",
        "created_at": datetime.now(),
    })

    return {
        "user": {
            "id": str(result.inserted_id),
            "name": name,
            "email": email,
            "role": "student",
        }
    }


# --- AUTH: LOGIN ---
@app.post("/login")
async def login(body: dict):
    email = body.get("email", "").strip().lower()
    password = body.get("password", "")

    user = await user_collection.find_one({"email": email})
    if not user or not pwd_context.verify(password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    return {
        "user": {
            "id": str(user["_id"]),
            "name": user["name"],
            "email": user["email"],
            "role": user.get("role", "student"),
        }
    }


# --- 0. GET CANTEENS (single canteen wrapping our menu) ---
@app.get("/canteens")
async def get_canteens():
    active_orders = await order_collection.count_documents({"status": {"$in": ["ordered", "preparing"]}})
    return {
        "canteens": [
            {
                "id": "canteen-main",
                "name": "Christ University Main Canteen",
                "campus": "Central Campus",
                "location": "Block 1, Ground Floor",
                "isActive": True,
                "openingTime": "08:00",
                "closingTime": "20:00",
                "avgPrepTime": 10,
                "_count": {"orders": active_orders},
            }
        ]
    }

# --- GET CANTEEN DETAIL ---
@app.get("/canteens/{canteen_id}")
async def get_canteen(canteen_id: str):
    return {
        "canteen": {
            "id": canteen_id,
            "name": "Christ University Main Canteen",
            "campus": "Central Campus",
            "location": "Block 1, Ground Floor",
            "isActive": True,
            "openingTime": "08:00",
            "closingTime": "20:00",
            "avgPrepTime": 10,
        }
    }

# --- GET CANTEEN MENU ---
@app.get("/canteens/{canteen_id}/menu")
async def get_canteen_menu(canteen_id: str):
    items = []
    async for item in menu_collection.find({}):
        item["id"] = str(item["_id"])
        del item["_id"]
        items.append(item)

    # Group into categories
    cat_map: dict = {}
    popular = []
    for item in items:
        cat = item.get("category", "Other")
        menu_item = {
            "id": item["id"],
            "name": item["name"],
            "price": item["price"],
            "description": item.get("description", ""),
            "isVeg": item.get("is_veg", True),
            "isAvailable": item.get("is_available", True),
            "isPopular": item.get("is_popular", True),
            "prepTimeMinutes": item.get("prep_time", 5),
        }
        if menu_item["isPopular"]:
            popular.append(menu_item)
        if cat not in cat_map:
            cat_map[cat] = {"id": cat.lower(), "name": cat, "items": []}
        cat_map[cat]["items"].append(menu_item)

    return {"categories": list(cat_map.values()), "popular": popular}

# --- GET PICKUP SLOTS ---
@app.get("/canteens/{canteen_id}/slots")
async def get_slots(canteen_id: str):
    now = datetime.now()
    slots = []
    # Generate 4 slots starting from the next 30-min boundary
    start = now.replace(second=0, microsecond=0)
    start += timedelta(minutes=(30 - start.minute % 30))
    for i in range(4):
        slot_start = start + timedelta(minutes=30 * i)
        slot_end = slot_start + timedelta(minutes=30)
        slots.append({
            "id": f"slot-{i}",
            "startTime": slot_start.strftime("%H:%M"),
            "endTime": slot_end.strftime("%H:%M"),
            "available": 10,
        })
    return {"slots": slots}

# --- PLACE ORDER (customer app) ---
@app.post("/orders")
async def place_order_v2(request: Request):
    body = await request.json()
    user_id = request.headers.get("x-user-id", "anonymous")

    canteen_id = body.get("canteenId", "canteen-main")
    slot_id = body.get("slotId")
    items_in = body.get("items", [])

    # Resolve menu items from DB
    items_out = []
    total_amount = 0
    for it in items_in:
        mid = it.get("menuItemId")
        qty = it.get("quantity", 1)
        menu_item = await menu_collection.find_one({"_id": ObjectId(mid)}) if ObjectId.is_valid(mid) else None
        if not menu_item:
            menu_item = await menu_collection.find_one({})
        price = menu_item.get("price", 0) if menu_item else 0
        name = menu_item.get("name", "Item") if menu_item else "Item"
        item_total = price * qty
        total_amount += item_total
        items_out.append({
            "menuItemId": mid,
            "menuItem": {"name": name, "price": price},
            "quantity": qty,
            "totalPrice": item_total,
        })

    # ETA prediction
    active_orders = await order_collection.count_documents({"status": {"$in": ["CONFIRMED", "PREPARING"]}})
    now = datetime.now()
    if ai_model:
        eta = int(round(ai_model.predict([[total_amount / 10, active_orders, 3, now.hour + now.minute / 60, 1.2]])[0]))
    else:
        eta = active_orders * 5 + 5

    count = await order_collection.count_documents({}) + 1
    order_doc = {
        "orderNumber": f"ORD-{count:04d}",
        "userId": user_id,
        "canteenId": canteen_id,
        "canteen": {"name": "Christ University Main Canteen"},
        "slotId": slot_id,
        "slot": None,
        "status": "CONFIRMED",
        "paymentMethod": body.get("paymentMethod", "WALLET"),
        "items": items_out,
        "totalAmount": total_amount,
        "etaMinutes": eta,
        "token": generate_token(),
        "createdAt": now,
    }
    result = await order_collection.insert_one(order_doc)
    order_doc["id"] = str(result.inserted_id)
    order_doc.pop("_id", None)  # remove ObjectId — FastAPI can't serialize it

    return {"order": order_doc}

# --- GET USER ORDERS ---
@app.get("/orders")
async def get_user_orders(request: Request):
    user_id = request.headers.get("x-user-id", "anonymous")
    orders = []
    async for o in order_collection.find({"userId": user_id}).sort("createdAt", -1).limit(20):
        o["id"] = str(o["_id"])
        del o["_id"]
        if isinstance(o.get("createdAt"), datetime):
            o["createdAt"] = o["createdAt"].isoformat()
        orders.append(o)
    return {"orders": orders}

# --- GET ORDER DETAIL ---
@app.get("/orders/{order_id}/qr")
async def get_order_qr(order_id: str):
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid ID")
    order = await order_collection.find_one({"_id": ObjectId(order_id)})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return {"qrCode": order.get("token", order_id)}

@app.get("/orders/{order_id}")
async def get_order(order_id: str):
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid ID")
    order = await order_collection.find_one({"_id": ObjectId(order_id)})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    order["id"] = str(order["_id"])
    del order["_id"]
    if isinstance(order.get("createdAt"), datetime):
        order["createdAt"] = order["createdAt"].isoformat()
    return {"order": order}

# --- GET WALLET ---
@app.get("/wallet")
async def get_wallet(request: Request):
    user_id = request.headers.get("x-user-id", "anonymous")
    wallet = await wallet_collection.find_one({"userId": user_id})
    if not wallet:
        wallet = {"userId": user_id, "balance": 0.0}
        await wallet_collection.insert_one(wallet)
    return {"wallet": {"id": str(wallet.get("_id", "wallet-1")), "balance": wallet["balance"]}}

# --- RECHARGE WALLET (simulated — swap for Razorpay verification in production) ---
@app.post("/wallet/recharge")
async def recharge_wallet(request: Request):
    body = await request.json()
    user_id = request.headers.get("x-user-id", "anonymous")
    amount = float(body.get("amount", 0))
    if amount < 10:
        raise HTTPException(status_code=400, detail="Minimum recharge is ₹10")

    wallet = await wallet_collection.find_one({"userId": user_id})
    if not wallet:
        await wallet_collection.insert_one({"userId": user_id, "balance": amount})
        new_balance = amount
    else:
        new_balance = wallet["balance"] + amount
        await wallet_collection.update_one({"userId": user_id}, {"$set": {"balance": new_balance}})

    await wallet_collection.update_one(
        {"userId": user_id},
        {"$push": {"transactions": {
            "id": str(ObjectId()),
            "type": "RECHARGE",
            "amount": amount,
            "description": f"Wallet recharge of ₹{amount:.0f}",
            "createdAt": datetime.now().isoformat(),
        }}}
    )
    return {"wallet": {"balance": new_balance}, "message": f"₹{amount:.0f} added successfully"}

# --- GET WALLET TRANSACTIONS ---
@app.get("/wallet/transactions")
async def get_wallet_transactions(request: Request):
    user_id = request.headers.get("x-user-id", "anonymous")
    wallet = await wallet_collection.find_one({"userId": user_id})
    txns = wallet.get("transactions", []) if wallet else []
    return {"transactions": list(reversed(txns))}

# --- 1. GET MENU ---
@app.get("/menu")
async def get_menu():
    menu = []
    async for item in menu_collection.find({}, {"_id": 0}):
        menu.append(item)
    return menu

# --- 2. PLACE ORDER ---
@app.post("/order")
async def place_order(order: Order):
    # A. Calculate Inputs for AI
    # Assume each item takes roughly 5 minutes * quantity
    total_prep_time = sum([item.qty * 5 for item in order.items])
    active_orders = await order_collection.count_documents({"status": {"$in": ["ordered", "preparing"]}})
    
    now = datetime.now()
    time_of_day = now.hour + (now.minute / 60)
    
    # B. Ask AI for Prediction
    if ai_model:
        # Inputs: [prep_time, active_orders, capacity, time, rush]
        prediction = ai_model.predict([[total_prep_time, active_orders, 3, time_of_day, 1.2]])
        eta = int(round(prediction[0]))
    else:
        eta = (active_orders * 5) + 5

    # C. Prepare Data
    new_order = order.dict()
    new_order["token"] = generate_token()
    new_order["eta_minutes"] = eta
    new_order["status"] = "ordered"
    new_order["created_at"] = datetime.now()

    # D. Save to MongoDB
    result = await order_collection.insert_one(new_order)
    
    return {
        "order_id": str(result.inserted_id),
        "pickup_token": new_order["token"],
        "eta_minutes": eta,
        "message": "Order Placed Successfully"
    }

# --- 3. VENDOR QUEUE ---
@app.get("/queue")
async def get_queue():
    terminal = {"collected", "PICKED_UP", "CANCELLED"}
    orders = []
    async for order in order_collection.find({"status": {"$nin": list(terminal)}}):
        order["id"] = str(order["_id"])
        del order["_id"]
        if isinstance(order.get("createdAt"), datetime):
            order["createdAt"] = order["createdAt"].isoformat()

        # Normalise status to uppercase (fix stale lowercase values)
        order["status"] = STATUS_MAP.get(order["status"].lower(), order["status"].upper())

        # Normalise items so vendor dashboard always gets {name, qty}
        normalised_items = []
        for item in order.get("items", []):
            name = item.get("name") or item.get("menuItem", {}).get("name", "Item")
            qty  = item.get("qty")  or item.get("quantity", 1)
            normalised_items.append({**item, "name": name, "qty": qty})
        order["items"] = normalised_items

        # Normalise ETA field
        order["eta_minutes"] = order.get("eta_minutes") or order.get("etaMinutes", 0)

        # Student name
        order.setdefault("customer_name", order.get("userId", "Customer"))

        orders.append(order)
    return orders

# --- 4. UPDATE STATUS ---
# Vendor dashboard sends old-style values (preparing / ready).
# Map them to the uppercase values the mobile app expects.
STATUS_MAP = {
    "preparing": "PREPARING",
    "ready": "READY",
    "collected": "PICKED_UP",
    "ordered": "CONFIRMED",
}

@app.post("/update_status/{order_id}")
async def update_status(order_id: str, status: str):
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid ID")
    normalised = STATUS_MAP.get(status.lower(), status.upper())
    await order_collection.update_one(
        {"_id": ObjectId(order_id)},
        {"$set": {"status": normalised}}
    )
    return {"status": "Updated"}

# --- 5. PICKUP ---
@app.post("/pickup")
async def pickup_order(order_id: str, token: str):
    order = await order_collection.find_one({"_id": ObjectId(order_id)})
    
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
        
    if order.get("token") != token:
        raise HTTPException(status_code=400, detail="Invalid Pickup Token!")
        
    await order_collection.update_one(
        {"_id": ObjectId(order_id)},
        {"$set": {"status": "collected"}}
    )
    return {"message": "Pickup Successful!"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)