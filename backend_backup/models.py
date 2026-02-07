from pydantic import BaseModel
from typing import List, Optional

# --- MENU ITEM SCHEMA ---
class MenuItem(BaseModel):
    name: str
    price: int
    category: str
    prep_time: int
    is_available: bool

# --- ORDER SCHEMA ---
class OrderItem(BaseModel):
    name: str
    qty: int

class Order(BaseModel):
    student_id: str
    items: List[OrderItem]
    total_price: int
    status: str = "QUEUED"  # Default status
    predicted_time: str = "Calculating..."