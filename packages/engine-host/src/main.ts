// main.ts — the supervisor's entry point when the DESKTOP APP drives it: NDJSON on stdio,
// no arguments, everything read from ~/.studio. cli.ts is the other front end, over the same
// startSupervisor; what stops either outliving its driver is hostLock.ts plus, here, stdin
// ending. The import order matters — ipcStdio quarantines stdout as an import side effect.

import { installProcessNet } from "./background.ts";
import { armDevReload, RELOAD_EXIT_CODE } from "./devReload.ts";
import { emit, listen } from "./ipcStdio.ts";
import { startSupervisor } from "./supervisor.ts";

// First, and only here: a rejected poll must not take the supervisor down with the engine behind it — see docs/background.md.
installProcessNet();

// Dev only: exit on a source change and let the tray relaunch us; the engine survives on its pidfile, so this costs no audio dropout.
if (
  armDevReload(() => {
    process.stderr.write("[host] source changed — reloading\n");
    process.exit(RELOAD_EXIT_CODE);
  })
) {
  process.stderr.write("[host] dev reload armed\n");
}

// Which subsystems this build's supervisor owns, flipped one at a time as the tray's Rust equivalents go.
void startSupervisor({
  own: {
    engine: true,
    fileService: true,
    engineQueries: true,
  },
  transport: { emit, listen },
}).catch((e) => {
  // Nothing above us will report this — the tray only sees a process that exited — so say why on stderr.
  process.stderr.write(`[host] fatal: ${e instanceof Error ? e.stack : e}\n`);
  process.exit(1);
});
