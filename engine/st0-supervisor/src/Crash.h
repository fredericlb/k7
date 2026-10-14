// Crash.h — what a crash leaves behind: the uncaught exception's message in the merged log and, on
// Windows, a minidump beside it. Without them an exit code of 0xC0000409 says only "aborted", and
// the app restarts us before anyone can look. See docs/supervisor.md.

#pragma once

namespace st0::crash {

/** Install the handlers; first thing in main, while there is one thread. */
void install();

}  // namespace st0::crash
