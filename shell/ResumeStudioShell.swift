// ResumeStudioShell — a native macOS window wrapping the local web app in a
// WKWebView, so the app has a real Dock icon, real window, and real quit
// behavior instead of a disguised Chrome tab. No Electron, no Tauri —
// AppKit + WebKit only, compiled with `swiftc` (ships with Xcode Command
// Line Tools). Inspired by Christian-Katzmann/app-it's approach (verified
// via trending-skill-finder, 2026-09-05) of wrapping an existing local
// project in a native WKWebView shell rather than rewriting it.
//
// Falls back to opening the URL in the default browser if for some reason
// the WebView fails to load (network hiccup on first launch, etc).

import Cocoa
import WebKit

let appURL = URL(string: "http://127.0.0.1:8765")!

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let config = WKWebViewConfiguration()
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1180, height: 800), configuration: config)
        webView.navigationDelegate = self
        webView.load(URLRequest(url: appURL))

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 800),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "ResumeStudio"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = true
        window.minSize = NSSize(width: 860, height: 560)
        window.center()
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)

        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        NSWorkspace.shared.open(appURL)
        NSApp.terminate(nil)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
