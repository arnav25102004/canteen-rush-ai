import motor.motor_asyncio

# 1. Connection String (Localhost)
MONGO_DETAILS = "mongodb://localhost:27017"

client = motor.motor_asyncio.AsyncIOMotorClient(MONGO_DETAILS)

# 2. Database Name
database = client.canteen_rush

# 3. Collections (The "Tables")
menu_collection = database.get_collection("menu")
order_collection = database.get_collection("orders")