package com.snaps.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class NapTimerAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (intent?.action != NapTimerScheduler.ACTION_ALARM) return
    val type = intent.getStringExtra(NapTimerScheduler.EXTRA_TYPE) ?: NapTimerScheduler.TYPE_END
    val title = intent.getStringExtra(NapTimerScheduler.EXTRA_TITLE) ?: "Naps"
    val body = intent.getStringExtra(NapTimerScheduler.EXTRA_BODY)
      ?: "Nap time is up — head to your destination!"
    NapTimerScheduler.showNotification(context, type, title, body)
  }
}
