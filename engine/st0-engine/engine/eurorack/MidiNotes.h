// MidiNotes.h — one MIDI message onto a note-playing core: anything with noteOn, noteOff,
// allNotesOff and setBend. A velocity-0 note-on is a note-off, which isNoteOn() already excludes.

#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

namespace studio::eurorack {

// The wheel's span either way, in semitones: the General MIDI default.
constexpr float BEND_RANGE = 2.0f;

template <typename Core>
void dispatchNotes(const juce::MidiMessage& m, Core& core)
{
    if (m.isNoteOn())
        core.noteOn(m.getNoteNumber(), m.getFloatVelocity());
    else if (m.isNoteOff())
        core.noteOff(m.getNoteNumber());
    else if (m.isAllNotesOff() || m.isAllSoundOff())
        core.allNotesOff();
    else if (m.isPitchWheel())
        core.setBend((float)(m.getPitchWheelValue() - 8192) / 8192.0f * BEND_RANGE);
}

}  // namespace studio::eurorack
