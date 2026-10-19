# surge.cmake — the four fixes Surge XT's core needs to build INSIDE this engine, applied at fetch time (PATCH_COMMAND).
# The one thing a reader would get wrong: upstream builds fine, alone; each fix is about being a subproject (docs/surgePlugin.md).

include("${CMAKE_CURRENT_LIST_DIR}/../eurorack/patches/studio_replace.cmake")

# r8brain is found under the TOP project's source dir, which is ours, not Surge's.
studio_replace("src/common/CMakeLists.txt"
    "\${CMAKE_SOURCE_DIR}/libs/r8brain-free-src/r8bbase.cpp"
    "\${SURGE_SOURCE_DIR}/libs/r8brain-free-src/r8bbase.cpp")
studio_replace("src/common/CMakeLists.txt"
    "PRIVATE \${CMAKE_SOURCE_DIR}/libs/r8brain-free-src)"
    "PRIVATE \${SURGE_SOURCE_DIR}/libs/r8brain-free-src)")

# Its version is the TOP project's too, and ours has none: version.cpp would read `MajorVersionInt = ;`.
# Only the configure-time branch is patched: the engine turns SURGE_RELIABLE_VERSION_INFO off, since that one stamps the time and relinks every build.
studio_replace("src/common/CMakeLists.txt"
    "else()\n  set(SURGESRC \${SURGE_SOURCE_DIR})\n"
    "else()\n  set(CMAKE_PROJECT_VERSION_MAJOR \${Surge_VERSION_MAJOR}) # studio: ours, not the top project's\n  set(CMAKE_PROJECT_VERSION_MINOR \${Surge_VERSION_MINOR})\n  set(SURGESRC \${SURGE_SOURCE_DIR})\n")

# On MSVC it forces the STATIC runtime (/MT), which cannot link into an engine built on the dynamic one (/MD).
studio_replace("CMakeLists.txt"
    "set(CMAKE_MSVC_RUNTIME_LIBRARY \"MultiThreaded$<$<CONFIG:Debug>:Debug>\")"
    "# studio: the C runtime is the parent's, never forced static here")

# A synth made with no config scans a factory library and creates ~/Documents/Surge XT: an engine must do neither.
studio_replace("src/common/SurgeSynthesizer.cpp"
    "    : storage(suppliedDataPath), hpA"
    "    : storage([&] { SurgeStorage::SurgeStorageConfig c; c.suppliedDataPath = suppliedDataPath; c.createUserDirectory = false; c.scanWavetableAndPatches = false; return c; }()), hpA")

# On Android, execinfo's backtrace() arrives with API 33 and the app starts at 29: the crash report's stack is left out there.
studio_replace("libs/sst/sst-plugininfra/src/misc_linux.cpp"
    "std::string stackTraceToString(int depth)\n{\n"
    "std::string stackTraceToString(int depth)\n{\n#if defined(__ANDROID__) // studio: no backtrace() before API 33\n    (void)depth;\n    return \"(no stack trace on Android)\";\n#else\n")
studio_replace("libs/sst/sst-plugininfra/src/misc_linux.cpp"
    "    free(strs);\n    return oss.str();\n}"
    "    free(strs);\n    return oss.str();\n#endif\n}")

# Android's pthreads are in its libc, and there is no libpthread to link: the name stays for every other UNIX.
studio_replace("src/common/CMakeLists.txt"
    "      pthread\n      -Wl,--no-undefined\n"
    "      $<$<NOT:$<PLATFORM_ID:Android>>:pthread> # studio: no libpthread on Android\n      -Wl,--no-undefined\n")
