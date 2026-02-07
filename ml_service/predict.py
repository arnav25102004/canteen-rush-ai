from fastapi import FastAPI
import joblib
import numpy as np
import os

app = FastAPI()

# Get absolute path of this file
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Absolute path to trained model
MODEL_PATH = os.path.join(BASE_DIR, "model", "queue_model.pkl")

# Load the trained ML model
model = joblib.load(MODEL_PATH)

@app.post("/predict")
def predict(
    prep_time: int,
    active_orders: int,
    vendor_capacity: int,
    time_of_day: float,
    rush_factor: float
):
    """
    Predicts wait time (in minutes) for an order
    """
    X = np.array([
        [prep_time, active_orders, vendor_capacity, time_of_day, rush_factor]
    ])

    prediction = model.predict(X)[0]

    return {
        "predicted_wait_time_minutes": int(round(prediction))
    }
