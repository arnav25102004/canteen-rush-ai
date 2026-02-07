import asyncio
from database import menu_collection

# The Food Menu
food_items = [
    {"name": "Veg Thali", "price": 80, "category": "Lunch", "prep_time": 5, "is_available": True},
    {"name": "Chicken Biryani", "price": 120, "category": "Lunch", "prep_time": 3, "is_available": True},
    {"name": "Masala Dosa", "price": 60, "category": "Breakfast", "prep_time": 8, "is_available": True},
    {"name": "Cold Coffee", "price": 40, "category": "Drinks", "prep_time": 4, "is_available": True},
    {"name": "Samosa (2pcs)", "price": 25, "category": "Snacks", "prep_time": 1, "is_available": True}
]

async def seed():
    print("🌱 Seeding Database...")
    # 1. Clear old menu to avoid duplicates
    await menu_collection.delete_many({})
    
    # 2. Add new items
    await menu_collection.insert_many(food_items)
    print("✅ Success! Menu added to MongoDB.")

if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.run_until_complete(seed())