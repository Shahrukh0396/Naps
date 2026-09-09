import UIKit
import UserNotifications
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import GoogleMaps
#if DEBUG
import Network
#endif

@main
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Must be first — Google Maps SDK for iOS (key from .env via react-native-config)
    let mapsKey = RNCConfig.env(for: "GOOGLE_MAPS_API_KEY") ?? ""
    GMSServices.provideAPIKey(mapsKey)

    UNUserNotificationCenter.current().delegate = self

    // Factory init overrides RN feature flags. That must happen before any
    // other React Native API (including RCTBundleURLProvider) is used.
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()
    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)
    window?.rootViewController = UIViewController()
    window?.makeKeyAndVisible()

#if DEBUG && !targetEnvironment(simulator)
    DebugMetroNetwork.shared.prepare { [weak self] in
      self?.startReactNative(launchOptions: launchOptions)
    }
#else
    startReactNative(launchOptions: launchOptions)
#endif

    return true
  }

  private func startReactNative(launchOptions: [UIApplication.LaunchOptionsKey: Any]?) {
    reactNativeFactory?.startReactNative(
      withModuleName: "GoogleNaps",
      in: window,
      launchOptions: launchOptions
    )
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    // Foreground: the in-app timer alarm handles it. Background / Maps: system banner + sound.
    if UIApplication.shared.applicationState == .active {
      completionHandler([])
    } else {
      completionHandler([.banner, .list, .sound])
    }
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    completionHandler()
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}

#if DEBUG
/// Physical devices need an explicit Local Network grant before Metro HTTP works.
/// iOS 18+ often will not prompt from a packager status check alone.
private final class DebugMetroNetwork {
  static let shared = DebugMetroNetwork()

  private var browser: NWBrowser?
  private var listener: NWListener?
  private var startedReactNative = false

  func prepare(then start: @escaping () -> Void) {
    startBonjour()
    // Next run loop so the permission sheet can appear before RN hits Metro.
    DispatchQueue.main.async { [weak self] in
      self?.waitForPackager(attemptsLeft: 40, then: start)
    }
  }

  private func startBonjour() {
    do {
      let listener = try NWListener(using: .tcp)
      listener.service = NWListener.Service(name: "naps-debug", type: "_http._tcp")
      listener.newConnectionHandler = { connection in
        connection.cancel()
      }
      listener.start(queue: .main)
      self.listener = listener
    } catch {
      // Browse still helps even if we cannot advertise.
    }

    let parameters = NWParameters()
    parameters.includePeerToPeer = true
    let browser = NWBrowser(for: .bonjour(type: "_http._tcp", domain: "local."), using: parameters)
    browser.start(queue: .main)
    self.browser = browser
  }

  private func waitForPackager(attemptsLeft: Int, then start: @escaping () -> Void) {
    if startedReactNative {
      return
    }
    isPackagerReachable { [weak self] reachable in
      guard let self else { return }
      if reachable || attemptsLeft <= 0 {
        self.finish(start: start, reachable: reachable)
        return
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
        self.waitForPackager(attemptsLeft: attemptsLeft - 1, then: start)
      }
    }
  }

  private func finish(start: @escaping () -> Void, reachable: Bool) {
    guard !startedReactNative else { return }
    if reachable {
      startedReactNative = true
      start()
      return
    }

    let alert = UIAlertController(
      title: "Can't reach Metro",
      message:
        "iOS blocked local network access, so the app cannot load from Metro.\n\n"
        + "1. Delete Naps from the phone, then reinstall from Xcode.\n"
        + "2. Tap Allow on Local Network.\n"
        + "3. Settings → Naps → Local Network must be on.\n"
        + "4. Phone and Mac on the same Wi‑Fi, Metro running.",
      preferredStyle: .alert
    )
    alert.addAction(UIAlertAction(title: "Open Settings", style: .default) { _ in
      if let url = URL(string: UIApplication.openSettingsURLString) {
        UIApplication.shared.open(url)
      }
    })
    alert.addAction(UIAlertAction(title: "Retry", style: .default) { [weak self] _ in
      self?.waitForPackager(attemptsLeft: 40, then: start)
    })
    alert.addAction(UIAlertAction(title: "Start anyway", style: .destructive) { [weak self] _ in
      self?.startedReactNative = true
      start()
    })
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first { $0.isKeyWindow }?
      .rootViewController?
      .present(alert, animated: true)
  }

  private func isPackagerReachable(_ completion: @escaping (Bool) -> Void) {
    guard let bundleURL = RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index"),
          var components = URLComponents(url: bundleURL, resolvingAgainstBaseURL: false)
    else {
      completion(false)
      return
    }
    components.path = "/status"
    components.query = nil
    guard let statusURL = components.url else {
      completion(false)
      return
    }

    var request = URLRequest(url: statusURL)
    request.timeoutInterval = 1.5
    URLSession.shared.dataTask(with: request) { _, response, _ in
      let ok = (response as? HTTPURLResponse)?.statusCode == 200
      DispatchQueue.main.async {
        completion(ok)
      }
    }.resume()
  }
}
#endif
