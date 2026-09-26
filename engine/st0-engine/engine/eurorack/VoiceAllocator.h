// VoiceAllocator.h — which of N mono voices a note goes to. A free voice first (the one released
// longest ago), else the oldest held one is stolen. The same key twice RETRIGGERS its voice rather
// than doubling it. JUCE-free and header-only, so tests/ covers it in the FAST binary.

#pragma once

#include <array>
#include <cstdint>

namespace studio::eurorack {

template <int MaxVoices>
class VoiceAllocator {
public:
    static constexpr int NONE = -1;

    void setVoices(int n) { voices_ = n < 1 ? 1 : (n > MaxVoices ? MaxVoices : n); }
    int voices() const { return voices_; }

    /** The voice `key` now plays on. */
    int noteOn(int key)
    {
        ++clock_;
        int pick = NONE;
        for (int v = 0; v < voices_; ++v)
            if (slot_[v].held && slot_[v].key == key) pick = v;
        // A free voice, longest released first, so a tail that is still ringing is the last to be cut.
        if (pick == NONE)
            for (int v = 0; v < voices_; ++v)
                if (!slot_[v].held && (pick == NONE || slot_[v].stamp < slot_[pick].stamp)) pick = v;
        if (pick == NONE) {
            pick = 0;
            for (int v = 1; v < voices_; ++v)
                if (slot_[v].stamp < slot_[pick].stamp) pick = v;
        }
        slot_[pick] = {key, true, clock_};
        return pick;
    }

    /** The voice `key` was playing on, now released; NONE when no held voice had it. */
    int noteOff(int key)
    {
        for (int v = 0; v < voices_; ++v) {
            if (slot_[v].held && slot_[v].key == key) {
                slot_[v].held = false;
                slot_[v].stamp = ++clock_;
                return v;
            }
        }
        return NONE;
    }

    void releaseAll()
    {
        for (auto& s : slot_) s.held = false;
    }

    bool held(int v) const { return slot_[v].held; }
    int key(int v) const { return slot_[v].key; }

private:
    struct Slot {
        int key = -1;
        bool held = false;
        uint64_t stamp = 0;
    };
    std::array<Slot, MaxVoices> slot_{};
    int voices_ = MaxVoices;
    uint64_t clock_ = 0;
};

}  // namespace studio::eurorack
