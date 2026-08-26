package com.snaps.app

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = NapTimerNotificationsModule.NAME)
class NapTimerNotificationsModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = NAME

  @ReactMethod
  fun requestPermission(promise: Promise) {
    // Android 13+ POST_NOTIFICATIONS is requested from JS.
    promise.resolve(true)
  }

  @ReactMethod
  fun schedule(options: ReadableMap, promise: Promise) {
    try {
      val warningAtMs =
        if (options.hasKey("warningAtMs")) options.getDouble("warningAtMs").toLong() else 0L
      val endsAtMs =
        if (options.hasKey("endsAtMs")) options.getDouble("endsAtMs").toLong() else 0L
      NapTimerScheduler.schedule(
        reactApplicationContext,
        warningAtMs,
        endsAtMs,
        if (options.hasKey("warningTitle")) options.getString("warningTitle") ?: "Naps" else "Naps",
        if (options.hasKey("warningBody")) options.getString("warningBody") ?: "" else "",
        if (options.hasKey("endTitle")) options.getString("endTitle") ?: "Naps" else "Naps",
        if (options.hasKey("endBody")) options.getString("endBody") ?: "Nap time is up" else "Nap time is up",
      )
      promise.resolve(null)
    } catch (err: Exception) {
      promise.reject("schedule", err)
    }
  }

  @ReactMethod
  fun cancel(promise: Promise) {
    try {
      NapTimerScheduler.cancel(reactApplicationContext)
      promise.resolve(null)
    } catch (err: Exception) {
      promise.reject("cancel", err)
    }
  }

  companion object {
    const val NAME = "NapTimerNotifications"
  }
}
