# sfizz.cmake — the two fixes sfizz 1.2.3 needs to build with today's compilers, applied at fetch time (PATCH_COMMAND).
# The one thing a reader would get wrong: upstream is ARCHIVED, so neither will ever be fixed there (docs/sfzPlugin.md).

include("${CMAKE_CURRENT_LIST_DIR}/../eurorack/patches/studio_replace.cmake")

# Its 32-bit ARM test also matches `arm64`, and clang refuses -mfpu/-mfloat-abi on Apple Silicon.
studio_replace("cmake/SfizzConfig.cmake"
    "elseif(PROJECT_SYSTEM_PROCESSOR MATCHES \"(arm.*)\")"
    "elseif(PROJECT_SYSTEM_PROCESSOR MATCHES \"^arm\" AND NOT PROJECT_SYSTEM_PROCESSOR MATCHES \"arm64|aarch64\")")

# Its vendored atomic_queue writes `x.template f()` with no argument list, an ERROR by default since clang 19.
studio_replace("cmake/SfizzConfig.cmake"
    "    gw_warn(-Wall -Wextra -Wno-multichar -Werror=return-type)"
    "    gw_warn(-Wall -Wextra -Wno-multichar -Werror=return-type)\n    if(CMAKE_CXX_COMPILER_ID MATCHES \"Clang\") # studio: atomic_queue vs clang 19\n        add_compile_options(-Wno-unknown-warning-option -Wno-missing-template-arg-list-after-template-kw)\n    endif()")
