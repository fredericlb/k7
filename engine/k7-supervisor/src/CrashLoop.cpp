// CrashLoop.cpp — see CrashLoop.h; pure arithmetic over the times it is handed, so its tests need no engine.

#include "CrashLoop.h"

#include <algorithm>

namespace k7 {

namespace {

/** 2^(n-1) seconds, capped: the n-th step of a backoff. */
std::chrono::seconds step(int n)
{
    return std::chrono::seconds(std::min(1 << std::min(n - 1, 5), CrashLoop::kBackoffMaxS));
}

}  // namespace

void CrashLoop::started(Time now)
{
    up_ = true;
    startedAt_ = now;
    failures_ = 0;
}

void CrashLoop::died(Time now)
{
    if (!up_) return;
    up_ = false;
    quick_ = now - startedAt_ < kQuick ? quick_ + 1 : 1;
    if (quick_ >= kSafeModeAfter) safe_ = true;
    // The first crash is relaunched at once, as a crash after a long run deserves.
    until_ = quick_ <= 1 ? now : now + step(quick_);
}

void CrashLoop::startFailed(Time now)
{
    up_ = false;
    until_ = now + step(++failures_);
}

void CrashLoop::reset()
{
    *this = CrashLoop{};
}

}  // namespace k7
