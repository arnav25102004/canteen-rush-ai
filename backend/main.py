from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session
from database import SessionLocal, engine
from models import Base, Order
from token_utils import generate_token, validate_token
from ml_client import get_eta
from queue_manager import next_state
import uuid

Base.metadata.create_all(bind=engine)

app = FastAPI()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.post("/order")
def place_order(student_id: str, vendor_id: str, prep_time: int, db: Session = Depends(get_db)):
    active_orders = db.query(Order).filter(Order.vendor_id == vendor_id, Order.status != "collected").count()

    eta = get_eta(
        prep_time=prep_time,
        active_orders=active_orders,
        capacity=3,
        time_of_day=11.5,
        rush=1.5
    )

    order = Order(
        order_id=str(uuid.uuid4()),
        student_id=student_id,
        vendor_id=vendor_id,
        prep_time=prep_time,
        eta_minutes=eta,
        status="ordered",
        token=generate_token()
    )

    db.add(order)
    db.commit()

    return {
        "order_id": order.order_id,
        "eta_minutes": eta,
        "pickup_token": order.token
    }

@app.post("/update_status")
def update_status(order_id: str, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.order_id == order_id).first()
    order.status = next_state(order.status)
    db.commit()
    return {"status": order.status}

@app.post("/pickup")
def pickup(order_id: str, token: str, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.order_id == order_id).first()

    if order.status != "ready":
        return {"error": "Order not ready"}

    if not validate_token(order.token, token):
        return {"error": "Invalid token"}

    order.status = "collected"
    db.commit()

    return {"message": "Pickup successful"}
