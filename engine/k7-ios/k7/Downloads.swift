// Downloads.swift — a file a page saves lands in the app's Documents/Downloads, which the Files app shows under
// k7. WKWebView hands an `<a download>` click on a `blob:`, `data:` or same-origin URL to a WKDownload with the
// session's cookies, so the page needs no help, unlike Android's. See engine/k7-runtime/docs/ios.md.

import WebKit

final class Downloads: NSObject, WKDownloadDelegate {
    static let shared = Downloads()

    private var names: [ObjectIdentifier: String] = [:]

    private var folder: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("Downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        // Never over a file already there: "take.wav", then "take (2).wav".
        let base = (suggestedFilename as NSString).deletingPathExtension
        let ext = (suggestedFilename as NSString).pathExtension
        var at = folder.appendingPathComponent(suggestedFilename)
        var n = 2
        while FileManager.default.fileExists(atPath: at.path) {
            at = folder.appendingPathComponent(ext.isEmpty ? "\(base) (\(n))" : "\(base) (\(n)).\(ext)")
            n += 1
        }
        names[ObjectIdentifier(download)] = at.lastPathComponent
        completionHandler(at)
    }

    func downloadDidFinish(_ download: WKDownload) {
        let name = names.removeValue(forKey: ObjectIdentifier(download)) ?? "the file"
        Dialogs.tell("Saved \(name) — Files › On My iPhone › k7 › Downloads")
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        names[ObjectIdentifier(download)] = nil
        Dialogs.tell("The download failed: \(error.localizedDescription)")
    }
}
