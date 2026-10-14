#pragma once

// CallbackWatchdog.h — decides when an OPEN audio device has stopped calling back, and when to
// stop reopening it. JUCE-free and header-only, so tests/ has it in a fast binary; the reopening
// itself is EngineHost::checkAudioCallback's (docs/audioDevice.md).
// What reads wrong: a counter that went DOWN is progress, not a stall — a reopen resets it.

namespace studio {

class CallbackWatchdog {
public:
    enum class Action { none, reopen, giveUp, resumed };

    // Consecutive checks without a single callback before a device counts as stalled.
    static constexpr int kStalledChecks = 2;
    // Reopens tried before the device is left alone: a driver another application holds refuses every one.
    static constexpr int kMaxReopens = 3;

    // One check, about once a second: whether a device is open, and the callback counter now.
    Action check(bool deviceOpen, long long runs) {
        if (!deviceOpen) {
            reset();
            return Action::none;
        }
        if (!seen_) {
            seen_ = true;
            runs_ = runs;
            return Action::none;
        }
        if (runs != runs_) {
            runs_ = runs;
            stalled_ = 0;
            const bool recovered = reopens_ > 0;
            reopens_ = 0;
            gaveUp_ = false;
            return recovered ? Action::resumed : Action::none;
        }
        if (++stalled_ < kStalledChecks) return Action::none;
        stalled_ = 0;
        if (reopens_ >= kMaxReopens) {
            if (gaveUp_) return Action::none;
            gaveUp_ = true;
            return Action::giveUp;
        }
        ++reopens_;
        return Action::reopen;
    }

    // The counter the reopened device starts from, so its first callback reads as progress.
    void reopened(long long runs) { runs_ = runs; }

    // How many reopens the current stall has cost so far.
    int reopens() const { return reopens_; }

    void reset() {
        seen_ = false;
        runs_ = 0;
        stalled_ = 0;
        reopens_ = 0;
        gaveUp_ = false;
    }

private:
    bool seen_ = false;
    long long runs_ = 0;
    int stalled_ = 0;
    int reopens_ = 0;
    bool gaveUp_ = false;
};

}  // namespace studio
