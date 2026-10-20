@AGENTS.md

Don't create Pull Request, only use branches and woktress

# Building and testing on Windows from the WSL clone

AGENTS.md's rule stands: nothing is built IN WSL, and Tilt's checkout `C:\Users\flb\Src\k7` is never
built by hand nor switched to another branch (Tilt watches it and would rebuild the running session).
What an agent may do is run a Windows build ON Windows, through WSL interop, in a worktree of its own:

- **The verify worktree is `C:\Users\flb\Src\k7-verify`**, outside Tilt's tree. A branch reaches it by
  `git push win <branch>`; create it once with `git worktree add --detach C:/Users/flb/Src/k7-verify <branch>`
  run from `C:\Users\flb\Src\k7`, then `git submodule update --init commons` and `npm ci` (25 s) inside it.
  Its build folders are its own, so it never fights Tilt's Ninja state; `buildLock.mjs` caps the compilers.
- **Every Windows step is a script FILE run by Git Bash**: write it under
  `C:\Users\flb\AppData\Local\Temp\k7-verify\` (`/mnt/c/...` from WSL), then run
  `/mnt/c/Users/flb/AppData/Local/Programs/Git/bin/bash.exe -l script.sh > step.log 2>&1` and read the log.
  Never PowerShell, never `cmd.exe` with a command line (UNC cwd warnings, and the encoding rules above).
- **A session isolated in a WSL worktree cannot run Windows commands** (the guard cannot prove they stay in
  the worktree): commit, push to `win`, leave the worktree, and drive Windows from the main session.
- **Git Bash rewrites `/flag` arguments into paths**: `/m:6` reaches MSBuild as `m:6`. Use CMake's portable
  `cmake --build <dir> --config RelWithDebInfo --target <t> --parallel 6`, or `MSYS_NO_PATHCONV=1`.
- **What fails on this machine whatever the branch** — check `main` before blaming a change:
  `file-hub/ports.test.ts` (`EADDRINUSE`, a port held by the dev session), and `k7_supervisor_tests`, which
  dies in `HostLock_test.cpp` (exit 127) so the files after it never run.
- **A C++ test binary that crashes loses its `ok`/`FAIL` lines** (stdout is buffered into a file). To see
  how far it got, add `std::setvbuf(stdout, nullptr, _IONBF, 0);` at the top of `main()` in the verify
  worktree only, rebuild, run, then `git checkout --` the file. `winpty` does not help without a tty.
- **A new test must hold on Windows too**: no file symlink without Developer Mode (`EPERM`), no POSIX mode
  (a file reads `0o666`) — guard those with `process.platform === "win32"`, as `atomicWrite.test.ts` does.

## Android

From the verify worktree's `engine/k7-android`, under Git Bash, with
`JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"` (JDK 21; Gradle refuses newer) and
`ANDROID_HOME=/c/Users/flb/AppData/Local/Android/Sdk` (NDK `29.0.14206865`):

- **Kotlin and the bundled backend only** — what a change outside the C++ needs, about a minute:
  `./gradlew.bat --no-daemon :app:stageBackend :app:compileE2eKotlin -x buildEngine -x buildSupervisor -x stageEngine -x stageFaustLibs -x stageTermuxTools`.
  `preBuild` depends on `stageEngine`, so without the `-x` it first compiles the whole engine for the phone.
- **`stageTermuxTools` fails under Git Bash** (`tar: Cannot connect to C:`): its GNU tar reads `C:` as a
  host. The full APK (`gradlew :app:assembleE2e`) runs from a Visual Studio developer prompt (`vcvars64`,
  Windows' own tar first on the PATH), as `engine/k7-runtime/docs/android.md` says.

## iOS

No Mac here: the only build is GitHub's `ios.yml`, started by hand on a branch (it attaches to a release only
on a `vX.Y.Z` tag). Pushing to GitHub goes through the Windows checkout's git, since the WSL key is not on
GitHub, and it is the user's to approve: ask, or give them
`! git.exe -C 'C:\Users\flb\Src\k7' push origin <branch> && gh workflow run ios.yml --ref <branch>`.
