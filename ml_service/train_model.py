import numpy as np
import joblib
import os
from sklearn.ensemble import RandomForestRegressor

# Simulated training data (cold start)
X = np.array([
    [5, 10, 3, 11.0, 1.4],
    [7, 20, 3, 12.0, 1.8],
    [4, 5,  2, 10.5, 1.2],
    [6, 15, 4, 11.5, 1.6],
    [8, 25, 3, 12.5, 1.9],
    [3, 2,  2, 9.5,  1.0]
])

# Target wait times (minutes)
y = np.array([12, 20, 7, 15, 25, 4])

# Train regression model
model = RandomForestRegressor(
    n_estimators=100,
    random_state=42
)

model.fit(X, y)

# Ensure model folder exists
os.makedirs("model", exist_ok=True)

# Save trained model
joblib.dump(model, "model/queue_model.pkl")

print("✅ Model trained and saved as model/queue_model.pkl")
