package com.example.christeats.network

import com.example.christeats.model.OrderRequest
import com.example.christeats.model.OrderResponse
import com.example.christeats.model.OrderState
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface ApiService {
    @POST("order")
    suspend fun placeOrder(
        @Body order: OrderRequest
    ): OrderResponse

    @GET("order/{orderId}/status")
    suspend fun getOrderStatus(
        @Path("orderId") orderId: String
    ): OrderState
}
