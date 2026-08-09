package com.example.christeats.ui.theme

import android.graphics.Bitmap
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.RepeatMode
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.christeats.model.OrderStatus
import com.example.christeats.viewmodel.OrderStatusViewModel
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import java.util.Locale

@Composable
fun OrderStatusScreen(
    viewModel: OrderStatusViewModel = viewModel(),
    onNavigateBack: () -> Unit
) {
    val orderState by viewModel.orderState.collectAsState()

    Scaffold(
        containerColor = Surface00
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(Modifier.height(24.dp))

            // Order ID Header
            Text(
                text = "Order #${orderState.orderId}",
                style = MaterialTheme.typography.labelMedium,
                color = TextTertiary,
                modifier = Modifier.align(Alignment.Start)
            )

            Spacer(Modifier.height(48.dp))

            // ETA Countdown Card (Hero)
            ETACountdownCard(
                timeRemaining = orderState.etaSeconds,
                status = orderState.status
            )

            Spacer(Modifier.height(32.dp))

            // Progress Rail
            ProgressRail(currentStatus = orderState.status)

            Spacer(Modifier.height(40.dp))

            // Pickup Pass Card (Highlighted)
            PickupPassCard(token = orderState.token)

            Spacer(Modifier.height(24.dp))

            // Metadata
            Text(
                text = "${orderState.vendor} — ${orderState.itemCount} items",
                style = MaterialTheme.typography.labelMedium,
                color = TextTertiary,
                fontWeight = FontWeight.Medium
            )

            Spacer(Modifier.weight(1f))

            // Cancel Button
            TextButton(
                onClick = {
                    viewModel.cancelOrder()
                    onNavigateBack()
                },
                modifier = Modifier.padding(bottom = 24.dp)
            ) {
                Text(
                    text = "Cancel Order",
                    color = TextTertiary,
                    style = MaterialTheme.typography.bodyLarge
                )
            }
        }
    }
}

@Composable
fun ETACountdownCard(
    timeRemaining: Int,
    status: OrderStatus
) {
    val minutes = timeRemaining / 60
    val seconds = timeRemaining % 60

    val targetColor = when (status) {
        OrderStatus.ORDERED -> Color(0x33FFFFFF)
        OrderStatus.PREPARING -> Preparing
        OrderStatus.READY -> ReadyGlow
    }

    val borderColor by animateColorAsState(targetValue = targetColor, animationSpec = tween(1000), label = "borderColor")
    
    val alphaAnim by animateFloatAsState(
        targetValue = if (status == OrderStatus.READY) 1f else 0.8f,
        animationSpec = infiniteRepeatable(
            animation = tween(1000),
            repeatMode = RepeatMode.Reverse
        ),
        label = "alphaAnim"
    )

    val displayText = if (status == OrderStatus.READY) {
        "Ready to Pickup!"
    } else {
        String.format(Locale.getDefault(), "%02d:%02d", minutes, seconds)
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .border(2.dp, borderColor.copy(alpha = alphaAnim), RoundedCornerShape(24.dp)),
        colors = CardDefaults.cardColors(containerColor = SurfaceGlass),
        shape = RoundedCornerShape(24.dp)
    ) {
        Column(
            modifier = Modifier.padding(vertical = 44.dp, horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = displayText,
                style = MaterialTheme.typography.displayLarge.copy(fontSize = 40.sp),
                color = if (status == OrderStatus.READY) ReadyGlow else TimePrimary
            )

            if (status != OrderStatus.READY) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = "minutes away",
                    style = MaterialTheme.typography.labelMedium,
                    color = TextSecondary
                )
            }
        }
    }
}

@Composable
fun ProgressRail(currentStatus: OrderStatus) {
    val stages = listOf("Ordered", "Preparing", "Ready")
    val currentIndex = currentStatus.ordinal

    Row(
        modifier = Modifier.fillMaxWidth(0.85f),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        stages.forEachIndexed { index, stage ->
            val isActive = index <= currentIndex
            val nodeColor by animateColorAsState(if (isActive) TimePrimary else TextTertiary, label = "nodeColor")

            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Box(
                    modifier = Modifier
                        .size(12.dp)
                        .background(nodeColor, CircleShape)
                        .then(
                            if (!isActive) Modifier.border(1.dp, Color(0x33FFFFFF), CircleShape) else Modifier
                        )
                )

                Spacer(Modifier.height(10.dp))

                Text(
                    text = stage,
                    style = MaterialTheme.typography.labelMedium.copy(fontSize = 11.sp),
                    color = if (isActive) TextPrimary else TextTertiary
                )
            }

            if (index < stages.size - 1) {
                val lineColor by animateColorAsState(if (index < currentIndex) TimePrimary else TextTertiary.copy(alpha = 0.3f), label = "lineColor")
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(2.dp)
                        .padding(horizontal = 8.dp)
                        .offset(y = (-11).dp)
                        .background(lineColor)
                )
            }
        }
    }
}

@Composable
fun PickupPassCard(token: String) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp)
            .border(1.dp, Color(0x1AFFFFFF), RoundedCornerShape(20.dp)),
        colors = CardDefaults.cardColors(containerColor = Surface02),
        shape = RoundedCornerShape(20.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 12.dp)
    ) {
        Column(
            modifier = Modifier.padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "SECURE PICKUP PASS",
                style = MaterialTheme.typography.labelMedium,
                color = TextSecondary,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.5.sp,
                modifier = Modifier.padding(bottom = 24.dp)
            )

            // QR Code - Highlighted and Centered
            Box(
                modifier = Modifier
                    .size(180.dp)
                    .background(Color.White, RoundedCornerShape(12.dp))
                    .padding(12.dp)
                    .border(4.dp, TimePrimary.copy(alpha = 0.2f), RoundedCornerShape(12.dp)),
                contentAlignment = Alignment.Center
            ) {
                val bitmap = generateQRCode(token)
                if (bitmap != null) {
                    Image(
                        bitmap = bitmap.asImageBitmap(),
                        contentDescription = "QR Code",
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }

            Spacer(Modifier.height(24.dp))

            Text(
                text = "TOKEN: $token",
                style = MaterialTheme.typography.headlineMedium.copy(
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 4.sp
                ),
                color = TimePrimary
            )
        }
    }
}

private fun generateQRCode(content: String): Bitmap? {
    return try {
        val writer = QRCodeWriter()
        val bitMatrix = writer.encode(content, BarcodeFormat.QR_CODE, 512, 512)
        val width = bitMatrix.width
        val height = bitMatrix.height
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.RGB_565)
        for (x in 0 until width) {
            for (y in 0 until height) {
                bitmap.setPixel(x, y, if (bitMatrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
            }
        }
        bitmap
    } catch (e: Exception) {
        null
    }
}
