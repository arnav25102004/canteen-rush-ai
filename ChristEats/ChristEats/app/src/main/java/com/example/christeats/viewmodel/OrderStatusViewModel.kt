package com.example.christeats.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.christeats.model.OrderState
import com.example.christeats.model.OrderStatus
import com.example.christeats.network.RetrofitClient
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class OrderStatusViewModel : ViewModel() {
    private val _orderState = MutableStateFlow(
        OrderState(
            orderId = "A142",
            status = OrderStatus.PREPARING,
            etaSeconds = 60,
            token = "A142",
            vendor = "MINGOS",
            itemCount = 2
        )
    )
    val orderState: StateFlow<OrderState> = _orderState.asStateFlow()
    
    private var isPolling = false

    init {
        // Call startTracking to begin server sync
        startTracking("A142")
        // Start local countdown for smooth UI updates
        startLocalTicker()
    }

    private fun startLocalTicker() {
        viewModelScope.launch {
            while (true) {
                delay(1000)
                _orderState.update { currentState ->
                    if (currentState.status != OrderStatus.READY && currentState.etaSeconds > 0) {
                        currentState.copy(etaSeconds = currentState.etaSeconds - 1)
                    } else if (currentState.etaSeconds == 0 && currentState.status != OrderStatus.READY) {
                        currentState.copy(status = OrderStatus.READY)
                    } else {
                        currentState
                    }
                }
            }
        }
    }

    fun startTracking(orderId: String) {
        if (isPolling) return
        isPolling = true
        
        viewModelScope.launch {
            while (isPolling) {
                try {
                    val status = RetrofitClient.api.getOrderStatus(orderId)
                    _orderState.value = status
                    
                    if (status.status == OrderStatus.READY) {
                        isPolling = false
                    }
                } catch (e: Exception) {
                    // Fail silently to keep the local ticker running
                }
                delay(5000) // Sync with server every 5 seconds
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        isPolling = false
    }

    fun cancelOrder() {
        isPolling = false
    }
}
