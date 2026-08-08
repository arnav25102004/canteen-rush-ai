package com.example.christeats.viewmodel

import androidx.lifecycle.ViewModel
import com.example.christeats.model.MenuItem
import com.example.christeats.model.OptimalWindow
import com.example.christeats.model.Vendor
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

class PreOrderViewModel : ViewModel() {
    private val _vendors = MutableStateFlow<List<Vendor>>(emptyList())
    val vendors: StateFlow<List<Vendor>> = _vendors.asStateFlow()
    
    private val _selectedVendor = MutableStateFlow<Vendor?>(null)
    val selectedVendor: StateFlow<Vendor?> = _selectedVendor.asStateFlow()
    
    private val _menuItems = MutableStateFlow<List<MenuItem>>(emptyList())
    val menuItems: StateFlow<List<MenuItem>> = _menuItems.asStateFlow()
    
    private val _optimalWindow = MutableStateFlow(OptimalWindow("11:42", "11:45"))
    val optimalWindow: StateFlow<OptimalWindow> = _optimalWindow.asStateFlow()
    
    init {
        loadMockData()
    }
    
    private fun loadMockData() {
        _vendors.value = listOf(
            Vendor("1", "MINGOS", true),
            Vendor("2", "CHRIST BAKERY", true),
            Vendor("3", "PUNJAB BITES", true)
        )
        _selectedVendor.value = _vendors.value[0]
        
        _menuItems.value = listOf(
            MenuItem("1", "Idli", 30.0),
            MenuItem("2", "Chicken Biryani", 120.0),
            MenuItem("3", "Vada", 20.0),
            MenuItem("4", "Coffee", 15.0),
            MenuItem("5", "Chai", 10.0)
        )
    }
    
    fun toggleMenuItem(itemId: String) {
        _menuItems.update { currentItems ->
            currentItems.map { item ->
                if (item.id == itemId) item.copy(isSelected = !item.isSelected) else item
            }
        }
    }
    
    fun selectVendor(vendor: Vendor) {
        _selectedVendor.value = vendor
    }

    fun getTotalAmount(): Double {
        return _menuItems.value.filter { it.isSelected }.sumOf { it.price }
    }
}
