# studio_eurorack — the eurorack modules' DSP and the JUCE-free cores that drive it.
#
# Its own library for two reasons. The firmware's headers #define NULL, CLIP, SLOPE and friends, so
# they must never share a translation unit with JUCE: everything here is JUCE-free, and a core's
# header exposes none of them. And it is compiled with TEST defined, which is how the firmware's own
# desktop harnesses build it (it switches the ARM-only paths off) — a define that must not reach
# anything else. The Tracktion plugins around these cores are in studio_engine. docs/eurorack.md.

set(ER "${STUDIO_EURORACK_DIR}")

add_library(studio_eurorack STATIC
    cores/PlaitsCore.cpp
    cores/BraidsCore.cpp
    cores/RingsCore.cpp
    cores/ElementsCore.cpp
    cores/CloudsCore.cpp
    cores/WarpsCore.cpp
    cores/TidesCore.cpp
    cores/PeaksCore.cpp

    ${STUDIO_STMLIB_ROOT}/stmlib/dsp/atan.cc
    ${STUDIO_STMLIB_ROOT}/stmlib/dsp/units.cc
    ${STUDIO_STMLIB_ROOT}/stmlib/utils/random.cc

    # Listed rather than globbed, like NAM's: a file the firmware adds is a deliberate edit here.
    ${ER}/plaits/resources.cc
    ${ER}/plaits/dsp/voice.cc
    ${ER}/plaits/dsp/chords/chord_bank.cc
    ${ER}/plaits/dsp/engine/additive_engine.cc
    ${ER}/plaits/dsp/engine/bass_drum_engine.cc
    ${ER}/plaits/dsp/engine/chord_engine.cc
    ${ER}/plaits/dsp/engine/fm_engine.cc
    ${ER}/plaits/dsp/engine/grain_engine.cc
    ${ER}/plaits/dsp/engine/hi_hat_engine.cc
    ${ER}/plaits/dsp/engine/modal_engine.cc
    ${ER}/plaits/dsp/engine/noise_engine.cc
    ${ER}/plaits/dsp/engine/particle_engine.cc
    ${ER}/plaits/dsp/engine/snare_drum_engine.cc
    ${ER}/plaits/dsp/engine/speech_engine.cc
    ${ER}/plaits/dsp/engine/string_engine.cc
    ${ER}/plaits/dsp/engine/swarm_engine.cc
    ${ER}/plaits/dsp/engine/virtual_analog_engine.cc
    ${ER}/plaits/dsp/engine/waveshaping_engine.cc
    ${ER}/plaits/dsp/engine/wavetable_engine.cc
    ${ER}/plaits/dsp/engine2/chiptune_engine.cc
    ${ER}/plaits/dsp/engine2/phase_distortion_engine.cc
    ${ER}/plaits/dsp/engine2/six_op_engine.cc
    ${ER}/plaits/dsp/engine2/string_machine_engine.cc
    ${ER}/plaits/dsp/engine2/virtual_analog_vcf_engine.cc
    ${ER}/plaits/dsp/engine2/wave_terrain_engine.cc
    ${ER}/plaits/dsp/fm/algorithms.cc
    ${ER}/plaits/dsp/fm/dx_units.cc
    ${ER}/plaits/dsp/physical_modelling/modal_voice.cc
    ${ER}/plaits/dsp/physical_modelling/resonator.cc
    ${ER}/plaits/dsp/physical_modelling/string_voice.cc
    ${ER}/plaits/dsp/physical_modelling/string.cc
    ${ER}/plaits/dsp/speech/lpc_speech_synth.cc
    ${ER}/plaits/dsp/speech/lpc_speech_synth_controller.cc
    ${ER}/plaits/dsp/speech/lpc_speech_synth_phonemes.cc
    ${ER}/plaits/dsp/speech/lpc_speech_synth_words.cc
    ${ER}/plaits/dsp/speech/naive_speech_synth.cc
    ${ER}/plaits/dsp/speech/sam_speech_synth.cc

    ${ER}/braids/resources.cc
    ${ER}/braids/analog_oscillator.cc
    ${ER}/braids/digital_oscillator.cc
    ${ER}/braids/macro_oscillator.cc

    ${ER}/rings/resources.cc
    ${ER}/rings/dsp/fm_voice.cc
    ${ER}/rings/dsp/part.cc
    ${ER}/rings/dsp/resonator.cc
    ${ER}/rings/dsp/string.cc
    ${ER}/rings/dsp/string_synth_part.cc

    ${ER}/elements/resources.cc
    ${ER}/elements/dsp/exciter.cc
    ${ER}/elements/dsp/multistage_envelope.cc
    ${ER}/elements/dsp/ominous_voice.cc
    ${ER}/elements/dsp/part.cc
    ${ER}/elements/dsp/resonator.cc
    ${ER}/elements/dsp/string.cc
    ${ER}/elements/dsp/tube.cc
    ${ER}/elements/dsp/voice.cc

    ${ER}/clouds/resources.cc
    ${ER}/clouds/dsp/correlator.cc
    ${ER}/clouds/dsp/granular_processor.cc
    ${ER}/clouds/dsp/mu_law.cc
    ${ER}/clouds/dsp/pvoc/frame_transformation.cc
    ${ER}/clouds/dsp/pvoc/phase_vocoder.cc
    ${ER}/clouds/dsp/pvoc/stft.cc

    ${ER}/warps/resources.cc
    ${ER}/warps/dsp/filter_bank.cc
    ${ER}/warps/dsp/modulator.cc
    ${ER}/warps/dsp/oscillator.cc
    ${ER}/warps/dsp/vocoder.cc

    ${ER}/tides2/resources.cc
    ${ER}/tides2/poly_slope_generator.cc
    ${ER}/tides2/ramp/ramp_extractor.cc

    ${ER}/peaks/resources.cc
    ${ER}/peaks/drums/bass_drum.cc
    ${ER}/peaks/drums/fm_drum.cc
    ${ER}/peaks/drums/high_hat.cc
    ${ER}/peaks/drums/snare_drum.cc)

# PUBLIC is only this folder: a core's header is the whole interface, and names nothing of the firmware's.
target_include_directories(studio_eurorack
    PUBLIC  ${CMAKE_CURRENT_SOURCE_DIR}
    PRIVATE ${ER} ${STUDIO_STMLIB_ROOT})
target_compile_definitions(studio_eurorack PRIVATE TEST)

# Third-party code written for an embedded GCC: its warnings are not ours to fix, and there are hundreds.
if(MSVC)
    target_compile_options(studio_eurorack PRIVATE /w)
else()
    target_compile_options(studio_eurorack PRIVATE -w)
endif()
