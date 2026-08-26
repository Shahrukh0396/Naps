package com.snaps.app

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

object NapTimerScheduler {
  const val ACTION_ALARM = "com.snaps.app.NAP_TIMER_ALARM"
  const val EXTRA_TYPE = "type"
  const val EXTRA_TITLE = "title"
  const val EXTRA_BODY = "body"
  const val TYPE_WARNING = "warning"
  const val TYPE_END = "end"

  private const val WARNING_REQUEST = 7101
  private const val END_REQUEST = 7102
  private const val WARNING_NOTIFY_ID = 7101
  private const val END_NOTIFY_ID = 7102
  private const val PREFS = "naps_timer_alarms"
  private const val CHANNEL_WARNING = "naps_timer_warning"
  private const val CHANNEL_END = "naps_timer_end"

  fun schedule(
    context: Context,
    warningAtMs: Long,
    endsAtMs: Long,
    warningTitle: String,
    warningBody: String,
    endTitle: String,
    endBody: String,
  ) {
    cancel(context)
    ensureChannels(context)

    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
    if (warningAtMs > System.currentTimeMillis() + 1500 && warningBody.isNotEmpty()) {
      arm(context, WARNING_REQUEST, warningAtMs, TYPE_WARNING, warningTitle, warningBody)
      prefs.putLong("warningAtMs", warningAtMs)
      prefs.putString("warningTitle", warningTitle)
      prefs.putString("warningBody", warningBody)
    }
    if (endsAtMs > System.currentTimeMillis() + 500) {
      arm(context, END_REQUEST, endsAtMs, TYPE_END, endTitle, endBody)
      prefs.putLong("endsAtMs", endsAtMs)
      prefs.putString("endTitle", endTitle)
      prefs.putString("endBody", endBody)
    }
    prefs.apply()
  }

  fun cancel(context: Context) {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    alarmManager.cancel(pending(context, WARNING_REQUEST, dummyIntent(context)))
    alarmManager.cancel(pending(context, END_REQUEST, dummyIntent(context)))
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    NotificationManagerCompat.from(context).cancel(WARNING_NOTIFY_ID)
    NotificationManagerCompat.from(context).cancel(END_NOTIFY_ID)
  }

  fun rescheduleFromPrefs(context: Context) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val warningAtMs = prefs.getLong("warningAtMs", 0)
    val endsAtMs = prefs.getLong("endsAtMs", 0)
    if (warningAtMs <= 0 && endsAtMs <= 0) return
    schedule(
      context,
      warningAtMs,
      endsAtMs,
      prefs.getString("warningTitle", "Naps") ?: "Naps",
      prefs.getString("warningBody", "") ?: "",
      prefs.getString("endTitle", "Naps") ?: "Naps",
      prefs.getString("endBody", "Nap time is up") ?: "Nap time is up",
    )
  }

  fun showNotification(context: Context, type: String, title: String, body: String) {
    ensureChannels(context)
    val isEnd = type == TYPE_END
    val launch = Intent(context, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val contentIntent = PendingIntent.getActivity(
      context,
      if (isEnd) END_NOTIFY_ID else WARNING_NOTIFY_ID,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val notification = NotificationCompat.Builder(
      context,
      if (isEnd) CHANNEL_END else CHANNEL_WARNING,
    )
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setAutoCancel(true)
      .setContentIntent(contentIntent)
      .setDefaults(if (isEnd) 0 else NotificationCompat.DEFAULT_ALL)
      .build()

    try {
      NotificationManagerCompat.from(context).notify(
        if (isEnd) END_NOTIFY_ID else WARNING_NOTIFY_ID,
        notification,
      )
    } catch (_: SecurityException) {
      // Notification permission denied.
    }
  }

  private fun arm(
    context: Context,
    requestCode: Int,
    triggerAtMs: Long,
    type: String,
    title: String,
    body: String,
  ) {
    val intent = Intent(context, NapTimerAlarmReceiver::class.java).apply {
      action = ACTION_ALARM
      putExtra(EXTRA_TYPE, type)
      putExtra(EXTRA_TITLE, title)
      putExtra(EXTRA_BODY, body)
    }
    val pending = pending(context, requestCode, intent)
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
      alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, pending)
    } else {
      alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, pending)
    }
  }

  private fun pending(context: Context, requestCode: Int, intent: Intent): PendingIntent {
    return PendingIntent.getBroadcast(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun dummyIntent(context: Context): Intent {
    return Intent(context, NapTimerAlarmReceiver::class.java).apply { action = ACTION_ALARM }
  }

  private fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val warning = NotificationChannel(
      CHANNEL_WARNING,
      "Nap timer reminders",
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = "Warns you before the nap timer ends while driving"
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 400, 120, 400)
    }
    val sound = Uri.parse("android.resource://${context.packageName}/${R.raw.timer}")
    val attrs = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    val end = NotificationChannel(
      CHANNEL_END,
      "Nap timer finished",
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = "Alerts when nap time is up, even if Google Maps is open"
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 500, 120, 500, 120, 700, 180, 500)
      setSound(sound, attrs)
    }
    manager.createNotificationChannel(warning)
    manager.createNotificationChannel(end)
  }
}
