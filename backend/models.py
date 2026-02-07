from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

# --- 1. MENU ITEM (For the Seed Script & Frontend) ---
class MenuItem(BaseModel):
    name: str
    price: int
    category: str
    prep_time: int
    is_available: bool

# --- 2. ORDER ITEM (What is inside an order) ---
class OrderItem(BaseModel):
    name: str
    qty: int

# --- 3. THE MASTER ORDER MODEL (Hybrid) ---
class Order(BaseModel):
    # --- YOUR FIELDS (For Frontend/Menu) ---
    student_id: str
    items: List[OrderItem]
    total_price: int
    
    # --- HER FIELDS (For AI & Queue Logic) ---
    token: Optional[str] = None         # Queue Token (e.g., "A-12")
    eta_minutes: Optional[int] = None   # AI Prediction (e.g., 12)
    
    # --- SHARED FIELDS ---
    status: str = "QUEUED"              # ordered, preparing, ready, collected
    created_at: datetime = Field(default_factory=datetime.now)

    class Config:
        # This helps MongoDB handle IDs correctly
        schema_extra = {
            "example": {
                "student_id": "2547115",
                "items": [{"name": "Veg Thali", "qty": 1}],
                "total_price": 80,
                "status": "QUEUED"
            }
        }