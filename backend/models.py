from sqlalchemy import Column, String, Integer, Float
from database import Base

class Order(Base):
    __tablename__ = "orders"

    order_id = Column(String, primary_key=True)
    student_id = Column(String)
    vendor_id = Column(String)
    prep_time = Column(Integer)
    eta_minutes = Column(Integer)
    status = Column(String)  # ordered, preparing, ready, collected
    token = Column(String)
