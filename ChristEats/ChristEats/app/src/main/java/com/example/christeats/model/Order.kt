package com.example.christeats.model

data class Vendor(val id: String, val name: String, val isOpen: Boolean)

data class MenuItem(
    val id: String, 
    val name: String, 
    val price: Double,
    var isSelected: Boolean = false
)

data class OptimalWindow(val startTime: String, val endTime: String)

enum class OrderStatus {
    ORDERED, PREPARING, READY
}

data class OrderState(
    val orderId: String,
    val status: OrderStatus,
    val etaSeconds: Int,
    val token: String,
    val vendor: String,
    val itemCount: Int,
    val totalAmount: Double = 0.0
)

data class OrderRequest(
    val vendorId: String,
    val items: List<String>
)

data class OrderResponse(
    val orderId: String,
    val eta: String,
    val token: String,
    val status: String
)
