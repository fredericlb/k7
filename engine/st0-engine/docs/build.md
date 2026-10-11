# Building the engine — one build per folder, and a compiler cap

`scripts/build.mjs` is what `npm run build:mac|win|android` and the dev session's watcher
(`scripts/dev-native.mjs`) both run. It configures only when there is no cache, then builds.

## One build per build folder

Ninja keeps no lock on its build folder. Two builds in one folder at once — the watcher rebuilding
on a save while a hand-started build runs — write `.ninja_deps` and `.ninja_log` over each other,
and ninja then reports the dependency records of whatever it lost as missing: every later build
recompiles all ~540 objects, JUCE, Tracktion, Faust and sfizz included, where it should have
recompiled one. Two of those at once put over two hundred compilers on the machine, enough to starve
macOS's WindowServer past its watchdog and take the session down.

So `build.mjs` takes `build/<preset>/.build.lock` (the holder's pid) before anything else; a second
build WAITS for it and says whose it is, and a lock whose process is gone — a crash, a kill — is
cleared. A bare `cmake --build build/<preset> --target studio_*_tests` does not go through it, so
build the test suites when no other build is running.

## A compiler cap where Ninja builds

Ninja runs cores + 2 jobs, and a JUCE or Tracktion unity file takes a gigabyte to compile. Where
Ninja builds (macOS, Linux, Android), `build.mjs` sets `CMAKE_BUILD_PARALLEL_LEVEL` to cores − 2,
unless the environment already sets it. Not under the Visual Studio generator: there the variable
becomes MSBuild's `/m`, projects in parallel on top of `/MP`'s files in parallel — the 144-compiler
case `AGENTS.md` warns about.
