import uuid

def generate_token():
    return str(uuid.uuid4())

def validate_token(order_token, provided_token):
    return order_token == provided_token
