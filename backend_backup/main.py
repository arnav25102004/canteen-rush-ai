from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from database import menu_collection, order_collection
from models import Order
from bson import ObjectId

app = FastAPI()

# --- CORS: Allow React & Android to connect ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 1. GET MENU (For Android App)
@app.get("/menu")
async def get_menu():
    menu = []
    async for item in menu_collection.find({}, {"_id": 0}):
        menu.append(item)
    return menu

# 2. PLACE ORDER (For Android App)
@app.post("/order")
async def place_order(order: Order):
    # --- AI LOGIC: Calculate Wait Time ---
    # Count how many orders are currently being prepared
    queue_length = await order_collection.count_documents({"status": "PREPARING"})
    
    # Logic: 5 mins base + 5 mins per existing order
    wait_time_minutes = (queue_length * 5) + 5
    
    # Prepare data for MongoDB
    new_order = order.dict()
    new_order["predicted_time"] = f"{wait_time_minutes} mins"
    new_order["status"] = "PREPARING"
    
    # Save to Database
    result = await order_collection.insert_one(new_order)
    
    # Add the generated ID to the response
    new_order["id"] = str(result.inserted_id)
    return new_order

# 3. GET QUEUE (For React Dashboard)
@app.get("/queue")
async def get_queue():
    orders = []
    async for order in order_collection.find({"status": "PREPARING"}):
        # Convert ObjectId to string for React
        order["id"] = str(order["_id"])
        del order["_id"]
        orders.append(order)
    return orders

# 4. COMPLETE ORDER (For React 'Mark Ready' Button)
@app.post("/complete/{id}")
async def complete_order(id: str):
    try:
        await order_collection.update_one(
            {"_id": ObjectId(id)},
            {"$set": {"status": "COMPLETED"}}
        )
        return {"status": "Order Completed"}
    except:
        raise HTTPException(status_code=400, detail="Invalid ID")