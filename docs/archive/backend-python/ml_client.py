import requests

ML_URL = "http://127.0.0.1:8001/predict"

def get_eta(prep_time, active_orders, capacity, time_of_day, rush):
    response = requests.post(
        ML_URL,
        params={
            "prep_time": prep_time,
            "active_orders": active_orders,
            "vendor_capacity": capacity,
            "time_of_day": time_of_day,
            "rush_factor": rush
        }
    )
    return response.json()["predicted_wait_time_minutes"]
