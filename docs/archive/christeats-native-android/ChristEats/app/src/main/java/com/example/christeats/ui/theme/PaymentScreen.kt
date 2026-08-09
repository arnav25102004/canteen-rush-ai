package com.example.christeats.ui.theme

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

@Composable
fun PaymentScreen(
    amount: Double,
    onPaymentSuccess: () -> Unit
) {
    var isProcessing by remember { mutableStateOf(false) }
    var isSuccess by remember { mutableStateOf(false) }

    LaunchedEffect(isProcessing) {
        if (isProcessing) {
            delay(2000)
            isSuccess = true
            delay(1500)
            onPaymentSuccess()
        }
    }

    Scaffold(
        containerColor = Surface00
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "Checkout",
                style = MaterialTheme.typography.headlineMedium,
                color = TextPrimary,
                modifier = Modifier.align(Alignment.Start)
            )

            Spacer(modifier = Modifier.height(48.dp))

            // Amount Card
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = Surface01),
                shape = RoundedCornerShape(24.dp)
            ) {
                Column(
                    modifier = Modifier.padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = "Total Amount",
                        style = MaterialTheme.typography.labelMedium,
                        color = TextSecondary
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "₹${String.format("%.2f", amount)}",
                        style = MaterialTheme.typography.displayLarge.copy(
                            fontSize = 48.sp,
                            fontWeight = FontWeight.Bold
                        ),
                        color = TimePrimary
                    )
                }
            }

            Spacer(modifier = Modifier.height(32.dp))

            if (!isProcessing) {
                PaymentMethods()
            } else {
                ProcessingOverlay(isSuccess)
            }

            Spacer(modifier = Modifier.weight(1f))

            if (!isProcessing) {
                Button(
                    onClick = { isProcessing = true },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(64.dp),
                    shape = RoundedCornerShape(32.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = TimePrimary)
                ) {
                    Text(
                        "Pay Now",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                    Icon(Icons.Default.KeyboardArrowRight, contentDescription = null)
                }
            }
        }
    }
}

@Composable
fun PaymentMethods() {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        PaymentOption("UPI", "Google Pay, PhonePe", true)
        PaymentOption("Cards", "Debit / Credit Card", false)
        PaymentOption("Wallet", "ChristEats Wallet", false)
    }
}

@Composable
fun PaymentOption(title: String, subtitle: String, selected: Boolean) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(if (selected) Surface02 else Surface01, RoundedCornerShape(16.dp))
            .border(
                1.dp,
                if (selected) TimePrimary else Color.Transparent,
                RoundedCornerShape(16.dp)
            )
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(12.dp)
                .background(if (selected) TimePrimary else TextTertiary, RoundedCornerShape(6.dp))
        )
        Spacer(modifier = Modifier.width(16.dp))
        Column {
            Text(title, color = TextPrimary, fontWeight = FontWeight.Bold)
            Text(subtitle, color = TextSecondary, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
fun ProcessingOverlay(isSuccess: Boolean) {
    val infiniteTransition = rememberInfiniteTransition()
    val scale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1.2f,
        animationSpec = infiniteRepeatable(
            animation = tween(1000),
            repeatMode = RepeatMode.Reverse
        )
    )

    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        if (!isSuccess) {
            CircularProgressIndicator(color = TimePrimary, modifier = Modifier.size(64.dp))
            Spacer(modifier = Modifier.height(24.dp))
            Text("Processing Payment...", color = TextSecondary)
        } else {
            Icon(
                imageVector = Icons.Default.CheckCircle,
                contentDescription = null,
                tint = ReadyGlow,
                modifier = Modifier
                    .size(80.dp)
                    .scale(scale)
            )
            Spacer(modifier = Modifier.height(24.dp))
            Text("Payment Successful!", color = ReadyGlow, fontWeight = FontWeight.Bold)
        }
    }
}
