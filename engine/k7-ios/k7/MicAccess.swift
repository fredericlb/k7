// MicAccess.swift — the microphone, asked when something first needs it: a page's getUserMedia, or a track armed
// on the engine. The engine never waits for it — without it the engine opens its device's outputs only — and a
// grant that comes after the engine started reaches it at the NEXT start, since inputs are opened once with the
// device. A refusal iOS remembers is not asked again: the app's Settings are offered. See engine/k7-runtime/docs/ios.md.

import AVFAudio
import UIKit

enum MicAccess {
    enum Answer { case granted, denied, blocked }

    /// Ask unless already decided; `answer` on the main thread.
    static func request(_ answer: @escaping (Answer) -> Void) {
        switch AVAudioApplication.shared.recordPermission {
        case .granted:
            DispatchQueue.main.async { answer(.granted) }
        case .denied:
            DispatchQueue.main.async {
                answer(.blocked)
                offerSettings()
            }
        default:
            AVAudioApplication.requestRecordPermission { granted in
                DispatchQueue.main.async {
                    answer(granted ? .granted : .denied)
                    if granted { afterGrant() }
                }
            }
        }
    }

    private static func offerSettings() {
        Dialogs.confirm(
            "Microphone",
            "k7 is not allowed to use the microphone. Allow it in Settings, then try again.",
            yes: "Settings", no: "Not now"
        ) { yes in
            guard yes, let url = URL(string: UIApplication.openSettingsURLString) else { return }
            UIApplication.shared.open(url)
        }
    }

    // The engine opened its device without inputs: they arrive with the next start, and quitting is the one restart there is.
    private static func afterGrant() {
        guard EngineBridge.startedWithMic == false else { return }
        if Busy.shared.busy {
            Dialogs.inform("Microphone", "The engine's inputs open at its next start: quit k7 once nothing is playing or recording.")
            return
        }
        Dialogs.confirm(
            "Microphone",
            "The engine's inputs open at its next start. Quit k7 now? Open it again from the home screen.",
            yes: "Quit", no: "Later"
        ) { yes in
            if yes { AppDelegate.quit() }
        }
    }
}
