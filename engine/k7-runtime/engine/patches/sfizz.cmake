# sfizz.cmake — the three fixes sfizz 1.2.3 needs to build with today's compilers and inside this engine, and the one
# feature it lacks (a gain per key), applied at fetch time (PATCH_COMMAND).
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

# A gain per KEY, in dB, added to a voice's volume when its note starts: a kit's pad louder than the rest,
# without the velocity that would also pick another layer (docs/sfzPlugin.md). Each edit inserts INSIDE its anchor.
studio_replace("src/sfizz/SynthConfig.h"
    "    bool sustainCancelsRelease { Default::sustainCancelsRelease };\n};"
    "    bool sustainCancelsRelease { Default::sustainCancelsRelease };\n    float keyGainDb[128] {}; // studio: a gain per key\n};")
studio_replace("src/sfizz/Voice.cpp"
    "impl.baseVolumedB_ = baseVolumedB(region, midiState, impl.triggerEvent_.number);"
    "impl.baseVolumedB_ = baseVolumedB(region, midiState, impl.triggerEvent_.number)\n        + (impl.triggerEvent_.type != TriggerEventType::CC ? resources.getSynthConfig().keyGainDb[impl.triggerEvent_.number & 127] : 0.0f); // studio")
studio_replace("src/sfizz/Synth.h"
    "    void setVolume(float volume) noexcept;\n\n    /**\n     * @brief Send a note on event to the synth\n"
    "    void setVolume(float volume) noexcept;\n    void setKeyGain(int key, float db) noexcept; // studio\n\n    /**\n     * @brief Send a note on event to the synth\n")
studio_replace("src/sfizz/Synth.cpp"
    "    impl.volume_ = Default::volume.bounds.clamp(volume);\n}\n\nint Synth::getNumVoices"
    "    impl.volume_ = Default::volume.bounds.clamp(volume);\n}\n\nvoid Synth::setKeyGain(int key, float db) noexcept // studio\n{\n    if (key >= 0 && key < 128) impl_->resources_.getSynthConfig().keyGainDb[key] = db;\n}\n\nint Synth::getNumVoices")
studio_replace("src/sfizz.hpp"
    "    void setVolume(float volume) noexcept;\n\n    /**\n     * @brief Send a note on event to the synth.\n"
    "    void setVolume(float volume) noexcept;\n    void setKeyGain(int key, float db) noexcept; // studio: a gain per key, RT thread\n\n    /**\n     * @brief Send a note on event to the synth.\n")
studio_replace("src/sfizz/sfizz.cpp"
    "    synth->synth.setVolume(volume);\n}\n\nvoid sfz::Sfizz::noteOn"
    "    synth->synth.setVolume(volume);\n}\n\nvoid sfz::Sfizz::setKeyGain(int key, float db) noexcept // studio\n{\n    synth->synth.setKeyGain(key, db);\n}\n\nvoid sfz::Sfizz::noteOn")

# An OUTPUT per key: a key routed to output N plays on the synth's Nth stereo pair, whatever its region says, so one
# pad of a kit can leave apart from the rest (engine docs/tapOutputs.md). Set off the RT thread: it may add buses.
# Each edit sits OUTSIDE the text the edits above wrote, so a re-run still finds theirs whole.
studio_replace("src/sfizz/SynthConfig.h"
    "    }\n\n    bool sustainCancelsRelease"
    "    }\n\n    unsigned char keyOutputPlus1[128] {}; // studio: a key's own output, plus one; 0 keeps its region's\n    bool sustainCancelsRelease")
studio_replace("src/sfizz/Synth.h"
    "     */\n    void setVolume(float volume) noexcept;\n    void setKeyGain(int key, float db) noexcept; // studio\n"
    "     */\n    void setKeyOutput(int key, int output) noexcept; // studio: a key's own output, -1 its region's\n    void setVolume(float volume) noexcept;\n    void setKeyGain(int key, float db) noexcept; // studio\n")
studio_replace("src/sfizz/Synth.cpp"
    "    return impl.volume_;\n}\nvoid Synth::setVolume(float volume) noexcept"
    "    return impl.volume_;\n}\n\nvoid Synth::setKeyOutput(int key, int output) noexcept // studio: NOT on the RT thread, it may add buses\n{\n    if (key < 0 || key >= 128 || output > 31) return;\n    Impl& impl = *impl_;\n    impl.resources_.getSynthConfig().keyOutputPlus1[key] = static_cast<unsigned char>(output < 0 ? 0 : output + 1);\n    if (output < 0) return;\n    impl.addEffectBusesIfNecessary(static_cast<uint16_t>(output));\n    impl.numOutputs_ = std::max(impl.numOutputs_, output + 1);\n}\n// studio: setKeyOutput above\nvoid Synth::setVolume(float volume) noexcept")
studio_replace("src/sfizz/Synth.cpp"
    "            const auto& effectBuses = impl.getEffectBusesForOutput(region->output);"
    "            // studio: a key routed to an output of its own plays there\n            const auto studioKeyOut = voice.getTriggerEvent().type != TriggerEventType::CC ? impl.resources_.getSynthConfig().keyOutputPlus1[voice.getTriggerEvent().number & 127] : 0;\n            const auto& effectBuses = impl.getEffectBusesForOutput(studioKeyOut ? static_cast<uint16_t>(studioKeyOut - 1) : region->output);")
studio_replace("src/sfizz.hpp"
    "     */\n    void setVolume(float volume) noexcept;\n    void setKeyGain(int key, float db) noexcept; // studio: a gain per key, RT thread\n"
    "     */\n    void setKeyOutput(int key, int output) noexcept; // studio: a key's own output pair, -1 its region's; NOT the RT thread\n    void setVolume(float volume) noexcept;\n    void setKeyGain(int key, float db) noexcept; // studio: a gain per key, RT thread\n")
studio_replace("src/sfizz/sfizz.cpp"
    "}\n\nvoid sfz::Sfizz::setVolume(float volume) noexcept"
    "}\n\nvoid sfz::Sfizz::setKeyOutput(int key, int output) noexcept // studio\n{\n    synth->synth.setKeyOutput(key, output);\n}\n// studio: setKeyOutput above\n\nvoid sfz::Sfizz::setVolume(float volume) noexcept")
