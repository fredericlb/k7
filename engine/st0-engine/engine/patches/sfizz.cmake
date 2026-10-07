# sfizz.cmake — the three fixes sfizz 1.2.3 needs to build with today's compilers and inside this engine, applied at fetch time (PATCH_COMMAND).
# The one thing a reader would get wrong: upstream is ARCHIVED, so none will ever be fixed there (docs/sfzPlugin.md).

include("${CMAKE_CURRENT_LIST_DIR}/../eurorack/patches/studio_replace.cmake")

# Its 32-bit ARM test also matches `arm64`, and clang refuses -mfpu/-mfloat-abi on Apple Silicon.
studio_replace("cmake/SfizzConfig.cmake"
    "elseif(PROJECT_SYSTEM_PROCESSOR MATCHES \"(arm.*)\")"
    "elseif(PROJECT_SYSTEM_PROCESSOR MATCHES \"^arm\" AND NOT PROJECT_SYSTEM_PROCESSOR MATCHES \"arm64|aarch64\")")

# Its vendored atomic_queue writes `x.template f()` with no argument list, an ERROR by default since clang 19.
# A kept source may hold that block several times over: folded into one before the patch below looks for it.
set(_clang_block "\n    if(CMAKE_CXX_COMPILER_ID MATCHES \"Clang\") # studio: atomic_queue vs clang 19\n        add_compile_options(-Wno-unknown-warning-option -Wno-missing-template-arg-list-after-template-kw)\n    endif()")
file(READ "cmake/SfizzConfig.cmake" _text)
string(FIND "${_text}" "${_clang_block}${_clang_block}" _at)
while(NOT _at EQUAL -1)
    string(REPLACE "${_clang_block}${_clang_block}" "${_clang_block}" _text "${_text}")
    string(FIND "${_text}" "${_clang_block}${_clang_block}" _at)
endwhile()
file(WRITE "cmake/SfizzConfig.cmake" "${_text}")
# Anchored on the line that FOLLOWED it, so the patched text does not contain the searched one and a re-run is a no-op.
studio_replace("cmake/SfizzConfig.cmake"
    "-Werror=return-type)\n    if(PROJECT_SYSTEM_PROCESSOR"
    "-Werror=return-type)\n    if(CMAKE_CXX_COMPILER_ID MATCHES \"Clang\") # studio: atomic_queue vs clang 19\n        add_compile_options(-Wno-unknown-warning-option -Wno-missing-template-arg-list-after-template-kw)\n    endif()\n    if(PROJECT_SYSTEM_PROCESSOR")

# On MSVC it forces the STATIC runtime (/MT), which cannot link into an engine built on the dynamic one (/MD).
studio_replace("cmake/SfizzConfig.cmake"
    "    set(CMAKE_MSVC_RUNTIME_LIBRARY \"MultiThreaded$<$<CONFIG:Debug>:Debug>\")"
    "    # studio: the C runtime is the parent's, never forced static here")
