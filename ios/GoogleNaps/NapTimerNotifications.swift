import Foundation
import UserNotifications
import UIKit

@objc(NapTimerNotifications)
class NapTimerNotifications: NSObject {
  static let warningId = "naps.timer.warning"
  static let endId = "naps.timer.end"

  @objc static func requiresMainQueueSetup() -> Bool {
    true
  }

  @objc func requestPermission(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    UNUserNotificationCenter.current().requestAuthorization(
      options: [.alert, .sound, .badge]
    ) { granted, error in
      if let error {
        reject("permission", error.localizedDescription, error)
        return
      }
      resolve(granted)
    }
  }

  @objc func schedule(
    _ options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let warningAtMs = (options["warningAtMs"] as? NSNumber)?.doubleValue ?? 0
    let endsAtMs = (options["endsAtMs"] as? NSNumber)?.doubleValue ?? 0
    let warningTitle = options["warningTitle"] as? String ?? "Naps"
    let warningBody = options["warningBody"] as? String ?? ""
    let endTitle = options["endTitle"] as? String ?? "Naps"
    let endBody = options["endBody"] as? String ?? "Nap time is up"

    let center = UNUserNotificationCenter.current()
    center.removePendingNotificationRequests(withIdentifiers: [
      Self.warningId,
      Self.endId,
    ])

    let group = DispatchGroup()
    var firstError: Error?

    if warningAtMs > 0 {
      group.enter()
      self.scheduleNotification(
        id: Self.warningId,
        title: warningTitle,
        body: warningBody,
        fireAtMs: warningAtMs,
        withAlarmSound: false,
        center: center
      ) { error in
        if firstError == nil { firstError = error }
        group.leave()
      }
    }

    if endsAtMs > 0 {
      group.enter()
      self.scheduleNotification(
        id: Self.endId,
        title: endTitle,
        body: endBody,
        fireAtMs: endsAtMs,
        withAlarmSound: true,
        center: center
      ) { error in
        if firstError == nil { firstError = error }
        group.leave()
      }
    }

    group.notify(queue: .main) {
      if let firstError {
        reject("schedule", firstError.localizedDescription, firstError)
      } else {
        resolve(NSNull())
      }
    }
  }

  @objc func cancel(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let center = UNUserNotificationCenter.current()
    center.removePendingNotificationRequests(withIdentifiers: [
      Self.warningId,
      Self.endId,
    ])
    center.removeDeliveredNotifications(withIdentifiers: [
      Self.warningId,
      Self.endId,
    ])
    resolve(NSNull())
  }

  private func scheduleNotification(
    id: String,
    title: String,
    body: String,
    fireAtMs: Double,
    withAlarmSound: Bool,
    center: UNUserNotificationCenter,
    completion: @escaping (Error?) -> Void
  ) {
    let fireDate = Date(timeIntervalSince1970: fireAtMs / 1000)
    let interval = fireDate.timeIntervalSinceNow
    guard interval >= 1 else {
      completion(nil)
      return
    }

    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = withAlarmSound ? Self.alarmSound() : .default
    content.threadIdentifier = "naps-timer"
    if #available(iOS 15.0, *) {
      content.interruptionLevel = .timeSensitive
    }

    let trigger = UNTimeIntervalNotificationTrigger(
      timeInterval: interval,
      repeats: false
    )
    let request = UNNotificationRequest(
      identifier: id,
      content: content,
      trigger: trigger
    )
    center.add(request, withCompletionHandler: completion)
  }

  private static func alarmSound() -> UNNotificationSound {
    if Bundle.main.path(forResource: "alarm-bell", ofType: "wav") != nil {
      return UNNotificationSound(named: UNNotificationSoundName("alarm-bell.wav"))
    }
    return .default
  }
}
