package com.example.christeats

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.example.christeats.ui.theme.ChristEatsTheme
import com.example.christeats.ui.theme.PreOrderScreen
import com.example.christeats.ui.theme.OrderStatusScreen
import com.example.christeats.ui.theme.SplashScreen
import com.example.christeats.ui.theme.PaymentScreen

sealed class Screen(val route: String) {
    object Splash : Screen("splash")
    object PreOrder : Screen("pre_order")
    object Payment : Screen("payment/{amount}") {
        fun createRoute(amount: Double) = "payment/$amount"
    }
    object OrderStatus : Screen("order_status")
}

@Composable
fun ChristEatsApp() {
    val navController = rememberNavController()
    
    NavHost(
        navController = navController, 
        startDestination = Screen.Splash.route,
        enterTransition = {
            slideIntoContainer(
                towards = AnimatedContentTransitionScope.SlideDirection.Left,
                animationSpec = tween(500)
            )
        },
        exitTransition = {
            slideOutOfContainer(
                towards = AnimatedContentTransitionScope.SlideDirection.Left,
                animationSpec = tween(500)
            )
        }
    ) {
        composable(Screen.Splash.route) {
            SplashScreen(onAnimationFinished = {
                navController.navigate(Screen.PreOrder.route) {
                    popUpTo(Screen.Splash.route) { inclusive = true }
                }
            })
        }
        
        composable(Screen.PreOrder.route) {
            PreOrderScreen(
                onPreOrder = { amount ->
                    navController.navigate(Screen.Payment.createRoute(amount))
                }
            )
        }

        composable(
            route = Screen.Payment.route,
            arguments = listOf(navArgument("amount") { type = NavType.FloatType })
        ) { backStackEntry ->
            val amount = backStackEntry.arguments?.getFloat("amount")?.toDouble() ?: 0.0
            PaymentScreen(
                amount = amount,
                onPaymentSuccess = {
                    navController.navigate(Screen.OrderStatus.route) {
                        popUpTo(Screen.PreOrder.route) { inclusive = true }
                    }
                }
            )
        }
        
        composable(Screen.OrderStatus.route) {
            OrderStatusScreen(
                onNavigateBack = {
                    navController.popBackStack(Screen.PreOrder.route, inclusive = false)
                }
            )
        }
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            ChristEatsTheme {
                ChristEatsApp()
            }
        }
    }
}
