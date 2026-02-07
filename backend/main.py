import sys
import os

# --- FIX 1: Add the current folder to Python's path so it finds 'database.py' ---
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from database import menu_collection, order_collection
from models import Order
from token_utils import generate_token, validate_token
from bson import ObjectId
import joblib
import numpy as np
from datetime import datetime

app = FastAPI()

# --- CORS (Allow All) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- LOAD THE AI MODEL ---
try:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    # --- FIX 2: Look in the PARENT folder for ml_service (..) ---
    MODEL_PATH = os.path.join(BASE_DIR, "..", "ml_service", "model", "queue_model.pkl")
    ai_model = joblib.load(MODEL_PATH)
    print("🧠 AI Model Loaded Successfully!")
except Exception as e:
    print(f"⚠️ Warning: AI Model not found. Using simple math. Error: {e}")
    ai_model = None

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
    orders = []
    async for order in order_collection.find({"status": {"$ne": "collected"}}):
        order["id"] = str(order["_id"])
        del order["_id"]
        orders.append(order)
    return orders

# --- 4. UPDATE STATUS ---
@app.post("/update_status/{order_id}")
async def update_status(order_id: str, status: str):
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid ID")
        
    await order_collection.update_one(
        {"_id": ObjectId(order_id)},
        {"$set": {"status": status}}
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