#pragma once

// RenderPool.h — how many threads render a playing Edit, and how its idle workers wait.
// JUCE-free and header-only, so tests/ has it in a fast binary; ServerBehaviour applies it (docs/renderPool.md).
// What reads wrong: `threads` counts the audio thread too, as Tracktion's getNumberOfCPUsToUseForAudio does.

#include <cstdlib>
#include <string>

namespace studio {

struct RenderPool {
    // Values of tracktion::graph::ThreadPoolStrategy, spelled out so this header needs no Tracktion.
    enum Strategy { conditionVariable = 0, realTime = 1, hybrid = 2, semaphore = 3, lightweightSemaphore = 4, lightweightSemHybrid = 5 };

    // A desktop renders on at most this many threads: past it the workers' waiting cost more than their work (docs/renderPool.md).
    static constexpr int kCappedThreads = 4;
    // A phone renders on at most this many, its big cores on a typical big.LITTLE chip; unmeasured there (docs/renderPool.md).
    static constexpr int kPhoneThreads = 4;

    enum Machine { desktop, phone };

    int threads;
    int strategy;

    // The default for a machine with `cpus` cores: a phone's workers sleep on a semaphore rather than spin (docs/renderPool.md).
    static RenderPool defaults(int cpus, Machine machine = desktop) {
        const int all = cpus < 1 ? 1 : cpus;
        const int cap = machine == phone ? kPhoneThreads : kCappedThreads;
        return {all > cap ? cap : all, machine == phone ? semaphore : lightweightSemHybrid};
    }

    // A strategy by its Tracktion name, or -1 for a name it does not have.
    static int strategyNamed(const std::string& name) {
        static const char* names[] = {"conditionVariable", "realTime", "hybrid", "semaphore", "lightweightSemaphore", "lightweightSemHybrid"};
        for (int i = 0; i < 6; ++i)
            if (name == names[i]) return i;
        return -1;
    }

    // The defaults, overridden by $STUDIO_ENGINE_AUDIO_THREADS and $STUDIO_ENGINE_AUDIO_POOL when they say something valid.
    static RenderPool fromEnv(int cpus, Machine machine, const char* threadsEnv, const char* poolEnv) {
        RenderPool p = defaults(cpus, machine);
        if (threadsEnv && *threadsEnv) {
            char* end = nullptr;
            const long n = std::strtol(threadsEnv, &end, 10);
            if (end && *end == '\0' && n >= 1) p.threads = n > cpus && cpus >= 1 ? cpus : static_cast<int>(n);
        }
        if (poolEnv && *poolEnv)
            if (const int s = strategyNamed(poolEnv); s >= 0) p.strategy = s;
        return p;
    }
};

}  // namespace studio
