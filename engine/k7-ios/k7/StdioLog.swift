// StdioLog.swift — the process's stdout and stderr into the system log. The engine, the supervisor and node
// all write there, as programs of their own would, and an iOS app's streams reach no Console a device shows.
// Lines keep their own tags (`[host]`, `[engine]`…); each is echoed to the original stderr for Xcode's console.
// See engine/k7-runtime/docs/ios.md.

import Foundation
import os

enum StdioLog {
    private static let log = Logger(subsystem: "se.frediver.k7", category: "stdio")

    /// Once, first thing in the process: what was written before goes to the original streams only.
    static func start() {
        let echo = dup(STDERR_FILENO)
        for fd in [STDOUT_FILENO, STDERR_FILENO] {
            var ends: [Int32] = [0, 0]
            guard pipe(&ends) == 0 else { continue }
            dup2(ends[1], fd)
            close(ends[1])
            let from = ends[0]
            let thread = Thread {
                readLines(from) { line in
                    log.info("\(line, privacy: .public)")
                    _ = (line + "\n").withCString { write(echo, $0, strlen($0)) }
                }
            }
            thread.name = fd == STDOUT_FILENO ? "k7-stdout" : "k7-stderr"
            thread.start()
        }
        setvbuf(stdout, nil, _IOLBF, 0)
        setvbuf(stderr, nil, _IOLBF, 0)
    }
}

/// Every complete line read from `fd` until it ends, on the calling thread; the descriptor is closed after.
func readLines(_ fd: Int32, _ each: (String) -> Void) {
    var pending = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    while true {
        let n = read(fd, &buffer, buffer.count)
        if n < 0 && errno == EINTR { continue }
        if n <= 0 { break }
        pending.append(buffer, count: n)
        while let nl = pending.firstIndex(of: 0x0A) {
            each(String(decoding: pending[pending.startIndex..<nl], as: UTF8.self))
            pending.removeSubrange(pending.startIndex...nl)
        }
    }
    close(fd)
}
