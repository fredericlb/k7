# When the engine or the supervisor crashes

## Where the evidence is

A crash writes nothing to `.studio.log` and nothing to the browser: the process is gone before
it could. The log shows only the aftermath — the supervisor exiting, an engine adopted or started
again. The stack is in the **OS's crash report**:

| OS | where |
|---|---|
| macOS | `~/Library/Logs/DiagnosticReports/st0-engine-<date>.ips`, `st0-supervisor-<date>.ips` |
| Windows | Event Viewer › Windows Logs › Application, "Application Error" for `st0-engine.exe` |
| Linux | `coredumpctl list st0-engine`, then `coredumpctl info <pid>` |

A macOS `.ips` is one JSON header line, then a JSON body. The faulting thread's frames, symbols
included in a local build, are the part to read:

```bash
python3 - ~/Library/Logs/DiagnosticReports/st0-engine-*.ips <<'EOF'
import json, sys
for f in sys.argv[1:]:
    d = json.loads(open(f).read().split("\n", 1)[1])
    t = d["threads"][d.get("faultingThread", 0)]
    print(f, d["exception"].get("signal"), d["exception"].get("subtype"))
    print("   ", " < ".join(fr.get("symbol", "?") for fr in t["frames"][:6]))
EOF
```

Several reports seconds apart with the same top frames is one bug hit on every restart, not
several: the engine crashes again as the same project is pushed back to it.

## The crash ADDRESS says what kind of bug it is

`KERN_INVALID_ADDRESS at 0xfffffffffffffff0` is not random corruption: it is a small negative
offset from a null pointer, which is what reading element `-1` of an EMPTY `juce::Array` produces.
A garbage address that changes from one report to the next points at a use-after-free instead.

## Tracktion's file-check queue

`AudioFileManager::handleAsyncUpdate` takes the last file of its `filesToCheck` queue without
checking the queue holds one. When the callback is delivered with nothing queued, it copies
element `-1` — an `AudioFile` is 24 bytes and its path sits 8 bytes in, hence `-16` — and the
engine dies on the message thread. `engine/patches/tracktion.cmake` returns early on an empty
queue. Checking for files that changed is a courtesy the engine does not depend on, so skipping a
delivery with nothing in it loses nothing.

## The supervisor's TLS seeding

See `engine/st0-supervisor/docs/supervisor.md`, "TLS from several threads".
