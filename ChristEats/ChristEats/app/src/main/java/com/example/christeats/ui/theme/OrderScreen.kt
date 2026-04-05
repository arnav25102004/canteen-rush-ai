package com.example.christeats.ui.theme

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.christeats.model.MenuItem
import com.example.christeats.model.OptimalWindow
import com.example.christeats.model.Vendor
import com.example.christeats.viewmodel.PreOrderViewModel

@Composable
fun PreOrderScreen(
    viewModel: PreOrderViewModel = viewModel(),
    onPreOrder: (Double) -> Unit
) {
    val vendors by viewModel.vendors.collectAsState()
    val selectedVendor by viewModel.selectedVendor.collectAsState()
    val menuItems by viewModel.menuItems.collectAsState()
    val optimalWindow by viewModel.optimalWindow.collectAsState()
    
    val totalAmount = remember(menuItems) {
        menuItems.filter { it.isSelected }.sumOf { it.price }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 20.dp)
                .verticalScroll(rememberScrollState())
        ) {
            Spacer(Modifier.height(24.dp))

            // Header
            Text(
                text = "ChristEats",
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onBackground
            )
            Text(
                text = "Your next break: 11:40 AM",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                modifier = Modifier.padding(top = 4.dp)
            )

            Spacer(Modifier.height(24.dp))

            // Vendor Selection Card
            VendorSelectionCard(
                vendors = vendors,
                selectedVendor = selectedVendor,
                onVendorSelected = { viewModel.selectVendor(it) }
            )

            Spacer(Modifier.height(16.dp))

            // Item Selection Grid
            Text(
                text = "Available Now",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.4f)
            )
            Spacer(Modifier.height(12.dp))
            ItemSelectionGrid(
                items = menuItems,
                onItemToggle = { viewModel.toggleMenuItem(it) }
            )

            Spacer(Modifier.height(24.dp))

            // Optimal Window Card
            OptimalPickupCard(window = optimalWindow)

            Spacer(Modifier.weight(1f))
            Spacer(Modifier.height(24.dp))

            // CTA Button with Price
            PreOrderButton(
                totalAmount = totalAmount,
                enabled = menuItems.any { it.isSelected },
                onClick = { onPreOrder(totalAmount) }
            )

            Spacer(Modifier.height(32.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VendorSelectionCard(
    vendors: List<Vendor>,
    selectedVendor: Vendor?,
    onVendorSelected: (Vendor) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = "🏪 Select Vendor",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
            )
            Spacer(Modifier.height(8.dp))

            ExposedDropdownMenuBox(
                expanded = expanded,
                onExpandedChange = { expanded = it }
            ) {
                OutlinedTextField(
                    value = selectedVendor?.name ?: "Choose a canteen",
                    onValueChange = {},
                    readOnly = true,
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .menuAnchor(MenuAnchorType.PrimaryNotEditable, expanded),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = MaterialTheme.colorScheme.onSurface,
                        unfocusedTextColor = MaterialTheme.colorScheme.onSurface,
                        focusedBorderColor = MaterialTheme.colorScheme.primary,
                        unfocusedBorderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f)
                    )
                )

                ExposedDropdownMenu(
                    expanded = expanded,
                    onDismissRequest = { expanded = false }
                ) {
                    vendors.forEach { vendor ->
                        DropdownMenuItem(
                            text = { Text(vendor.name, color = MaterialTheme.colorScheme.onSurface) },
                            onClick = {
                                onVendorSelected(vendor)
                                expanded = false
                            },
                            contentPadding = ExposedDropdownMenuDefaults.ItemContentPadding
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun ItemSelectionGrid(
    items: List<MenuItem>,
    onItemToggle: (String) -> Unit
) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(2),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.height(200.dp)
    ) {
        items(items) { item ->
            FilterChip(
                selected = item.isSelected,
                onClick = { onItemToggle(item.id) },
                label = {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = item.name,
                            style = MaterialTheme.typography.bodyLarge,
                            textAlign = TextAlign.Center
                        )
                        Text(
                            text = "₹${item.price.toInt()}",
                            style = MaterialTheme.typography.labelSmall,
                            color = if (item.isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f)
                        )
                    }
                },
                trailingIcon = if (item.isSelected) {
                    {
                        Icon(
                            Icons.Default.Check,
                            contentDescription = null,
                            Modifier.size(16.dp)
                        )
                    }
                } else null,
                colors = FilterChipDefaults.filterChipColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    selectedContainerColor = MaterialTheme.colorScheme.surface,
                    labelColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                    selectedLabelColor = MaterialTheme.colorScheme.onSurface,
                    iconColor = MaterialTheme.colorScheme.primary
                ),
                border = FilterChipDefaults.filterChipBorder(
                    borderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.1f),
                    selectedBorderColor = MaterialTheme.colorScheme.primary,
                    disabledBorderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.05f),
                    disabledSelectedBorderColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.2f),
                    borderWidth = 1.dp,
                    selectedBorderWidth = 2.dp,
                    enabled = true,
                    selected = item.isSelected
                ),
                modifier = Modifier.height(56.dp) // Increased height for price
            )
        }
    }
}

@Composable
fun OptimalPickupCard(window: OptimalWindow) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("⏱", fontSize = 16.sp)
                Spacer(Modifier.width(8.dp))
                Text(
                    text = "Optimal Pickup Window",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                )
            }

            Spacer(Modifier.height(8.dp))

            Text(
                text = "${window.startTime} – ${window.endTime}",
                style = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.colorScheme.primary
            )

            Spacer(Modifier.height(4.dp))

            Text(
                text = "Based on your schedule",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f)
            )
        }
    }
}

@Composable
fun PreOrderButton(
    totalAmount: Double,
    enabled: Boolean,
    onClick: () -> Unit
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier
            .fillMaxWidth()
            .height(64.dp), // Increased height for price display
        shape = RoundedCornerShape(24.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
            disabledContainerColor = MaterialTheme.colorScheme.surfaceVariant,
            disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
        )
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Pre-Order for Break",
                style = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            )
            
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (totalAmount > 0) {
                    Text(
                        text = "₹${totalAmount.toInt()}",
                        style = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.Bold),
                        modifier = Modifier.padding(end = 12.dp)
                    )
                }
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp)
                )
            }
        }
    }
}
