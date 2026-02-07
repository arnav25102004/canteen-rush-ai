def next_state(current):
    flow = {
        "ordered": "preparing",
        "preparing": "ready",
        "ready": "collected"
    }
    return flow.get(current, current)
