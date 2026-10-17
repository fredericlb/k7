// MediaPlayback.swift — what a page plays, shown to the system: Now Playing and the lock screen's and a headset's
// buttons, from the page's own Media Session (media-session.js, `media`), each button sent back as `media-action`.
// The bar may play through the ENGINE, which WebKit knows nothing of, so the app relays what the page says rather
// than leaving it to WebKit's own media. See engine/k7-runtime/docs/ios.md.

import MediaPlayer
import WebKit

enum MediaPlayback {
    private static weak var view: WKWebView?
    private static var wired = false

    /// The page's state, on the main thread; `from` is the view that said it, where the buttons go.
    static func update(_ msg: [String: Any], from webView: WKWebView) {
        wire()
        let state = msg["state"] as? String ?? "none"
        let actions = Set(msg["actions"] as? [String] ?? [])
        let center = MPRemoteCommandCenter.shared()
        // A page that cleared its session takes its controls with it.
        if state == "none" || (msg["title"] as? String ?? "").isEmpty && actions.isEmpty {
            clear()
            return
        }
        view = webView
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: msg["title"] as? String ?? "",
            MPMediaItemPropertyArtist: msg["artist"] as? String ?? "",
            MPMediaItemPropertyAlbumTitle: msg["album"] as? String ?? "",
            MPNowPlayingInfoPropertyPlaybackRate: state == "playing" ? (msg["rate"] as? Double ?? 1) : 0,
        ]
        if let duration = msg["duration"] as? Double, duration > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = duration
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = msg["position"] as? Double ?? 0
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        center.playCommand.isEnabled = actions.contains("play")
        center.pauseCommand.isEnabled = actions.contains("pause")
        center.togglePlayPauseCommand.isEnabled = actions.contains("play") || actions.contains("pause")
        center.nextTrackCommand.isEnabled = actions.contains("nexttrack")
        center.previousTrackCommand.isEnabled = actions.contains("previoustrack")
        center.changePlaybackPositionCommand.isEnabled = actions.contains("seekto")
        center.stopCommand.isEnabled = actions.contains("stop")
        playing = state == "playing"
    }

    private static var playing = false

    /// Nothing plays any more: no controls left to drive a page that is gone.
    static func clear() {
        view = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        let center = MPRemoteCommandCenter.shared()
        for command in [center.playCommand, center.pauseCommand, center.togglePlayPauseCommand, center.nextTrackCommand,
                        center.previousTrackCommand, center.changePlaybackPositionCommand, center.stopCommand] {
            command.isEnabled = false
        }
    }

    // Each system button, sent to the page that set the session, as the action its own handler answers to.
    private static func wire() {
        if wired { return }
        wired = true
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { _ in send("play") }
        center.pauseCommand.addTarget { _ in send("pause") }
        center.togglePlayPauseCommand.addTarget { _ in send(playing ? "pause" : "play") }
        center.nextTrackCommand.addTarget { _ in send("nexttrack") }
        center.previousTrackCommand.addTarget { _ in send("previoustrack") }
        center.stopCommand.addTarget { _ in send("stop") }
        center.changePlaybackPositionCommand.addTarget { event in
            guard let seek = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            return send("seekto", seekTime: seek.positionTime)
        }
    }

    private static func send(_ action: String, seekTime: Double? = nil) -> MPRemoteCommandHandlerStatus {
        guard let view else { return .noActionableNowPlayingItem }
        var msg: [String: Any] = ["t": "media-action", "action": action]
        if let seekTime { msg["seekTime"] = seekTime }
        StudioBridge.post(msg, to: view)
        return .success
    }
}
