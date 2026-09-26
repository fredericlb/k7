// Performance.cpp — see Performance.h. The biquad is the same loop and the same budget as the
// TypeScript probe's, but compiled code runs it faster than a JIT did, so the reference's
// `singleThread` is the one number this change of supervisor moves (docs/supervisor.md).

#include "Performance.h"

#include "Processes.h"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <thread>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#else
#include <fcntl.h>
#include <unistd.h>
#ifdef __APPLE__
#include <sys/sysctl.h>
#endif
#endif

namespace st0::performance {

namespace {

constexpr int kBlock = 4096;
constexpr double kCpuBudgetMs = 200;
constexpr size_t kWriteBytes = 16 * 1024 * 1024;
constexpr size_t kWriteChunk = 1024 * 1024;
constexpr int kFsyncCount = 32;

struct Weighted {
    double Metrics::*plain;
    std::optional<double> Metrics::*optional;
    double reference;
    double weight;
};

const Weighted kWeights[] = {
    {&Metrics::singleThread, nullptr, 60, 0.35},
    {&Metrics::cores, nullptr, 8, 0.25},
    {nullptr, &Metrics::diskWriteMBps, 500, 0.15},
    {nullptr, &Metrics::fsyncPerSec, 200, 0.10},
    {&Metrics::memoryGB, nullptr, 16, 0.15},
};

using Clock = std::chrono::steady_clock;

double msSince(Clock::time_point t) { return std::chrono::duration<double, std::milli>(Clock::now() - t).count(); }

double singleThread()
{
    std::vector<float> buf(kBlock);
    for (int i = 0; i < kBlock; ++i) buf[i] = std::sin(i * 0.05f);
    const float b0 = 0.0039f, b1 = 0.0078f, b2 = 0.0039f, a1 = -1.8153f, a2 = 0.8309f;
    volatile float sink = 0;
    float x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    auto pass = [&] {
        for (int i = 0; i < kBlock; ++i) {
            const float x = buf[i];
            const float y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
            x2 = x1;
            x1 = x;
            y2 = y1;
            y1 = y;
            buf[i] = y;
        }
    };
    for (int i = 0; i < 200; ++i) pass();
    double samples = 0;
    const auto start = Clock::now();
    double elapsed = 0;
    while (elapsed < kCpuBudgetMs) {
        for (int i = 0; i < 50; ++i) pass();
        samples += 50.0 * kBlock;
        elapsed = msSince(start);
    }
    // Keeps the loop observable, so it cannot be optimised away.
    sink = y1;
    if (!std::isfinite(static_cast<float>(sink))) return 0;
    return samples / elapsed / 1000;
}

double memoryGB()
{
#ifdef _WIN32
    MEMORYSTATUSEX m{sizeof m};
    GlobalMemoryStatusEx(&m);
    return static_cast<double>(m.ullTotalPhys) / (1024.0 * 1024 * 1024);
#elif defined(__APPLE__)
    int64_t bytes = 0;
    size_t len = sizeof bytes;
    sysctlbyname("hw.memsize", &bytes, &len, nullptr, 0);
    return static_cast<double>(bytes) / (1024.0 * 1024 * 1024);
#else
    return static_cast<double>(sysconf(_SC_PHYS_PAGES)) * static_cast<double>(sysconf(_SC_PAGE_SIZE)) /
           (1024.0 * 1024 * 1024);
#endif
}

#ifdef _WIN32
int openWrite(const std::filesystem::path& p) { return _wopen(p.wstring().c_str(), _O_WRONLY | _O_CREAT | _O_TRUNC | _O_BINARY, 0644); }
int writeAll(int fd, const char* b, size_t n) { return _write(fd, b, static_cast<unsigned>(n)); }
int syncFd(int fd) { return _commit(fd); }
void closeFd(int fd) { _close(fd); }
#else
int openWrite(const std::filesystem::path& p) { return open(p.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0644); }
int writeAll(int fd, const char* b, size_t n) { return static_cast<int>(write(fd, b, n)); }
int syncFd(int fd) { return fsync(fd); }
void closeFd(int fd) { close(fd); }
#endif

void measureDisk(const std::filesystem::path& dir, Metrics& m)
{
    std::error_code ec;
    std::filesystem::create_directories(dir, ec);
    const auto file = dir / (".perf-probe-" + std::to_string(process::currentPid()));
    std::vector<char> chunk(kWriteChunk, 0x5a);
    int fd = openWrite(file);
    // Read-only or full: unknown, which the score leaves out, never "slow".
    if (fd < 0) return;
    auto start = Clock::now();
    bool ok = true;
    for (size_t n = 0; n < kWriteBytes && ok; n += kWriteChunk) ok = writeAll(fd, chunk.data(), kWriteChunk) > 0;
    ok = ok && syncFd(fd) == 0;
    closeFd(fd);
    const double writeMs = msSince(start);
    if (ok) {
        fd = openWrite(file);
        if (fd >= 0) {
            start = Clock::now();
            for (int i = 0; i < kFsyncCount && ok; ++i) ok = writeAll(fd, chunk.data(), kBlock) > 0 && syncFd(fd) == 0;
            closeFd(fd);
            const double fsyncMs = msSince(start);
            if (ok) {
                m.diskWriteMBps = (kWriteBytes / (1024.0 * 1024)) / (writeMs / 1000);
                m.fsyncPerSec = kFsyncCount / (fsyncMs / 1000);
            }
        }
    }
    std::filesystem::remove(file, ec);
}

}  // namespace

int score(const Metrics& m)
{
    double logSum = 0, weight = 0;
    for (const auto& w : kWeights) {
        const std::optional<double> v = w.plain ? std::optional<double>(m.*(w.plain)) : m.*(w.optional);
        if (!v || !(*v > 0)) continue;
        logSum += w.weight * std::log(*v / w.reference);
        weight += w.weight;
    }
    if (weight == 0) return 0;
    return std::max(1, static_cast<int>(std::lround(1000 * std::exp(logSum / weight))));
}

Metrics measure(const std::filesystem::path& dir)
{
    Metrics m;
    m.cores = static_cast<double>(std::max(1u, std::thread::hardware_concurrency()));
    m.singleThread = singleThread();
    measureDisk(dir, m);
    m.memoryGB = memoryGB();
    return m;
}

nlohmann::json toJson(const Metrics& m)
{
    return {
        {"cores", m.cores},
        {"singleThread", m.singleThread},
        {"diskWriteMBps", m.diskWriteMBps ? nlohmann::json(*m.diskWriteMBps) : nlohmann::json(nullptr)},
        {"fsyncPerSec", m.fsyncPerSec ? nlohmann::json(*m.fsyncPerSec) : nlohmann::json(nullptr)},
        {"memoryGB", m.memoryGB},
        {"score", score(m)},
    };
}

}  // namespace st0::performance
