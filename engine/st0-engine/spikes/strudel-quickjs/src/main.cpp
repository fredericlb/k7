// main.cpp — the spike's verdict: QuickJS events equal Node's for every corpus pattern, at what cost, with what guards.
// Usage: strudel_qjs <spike dir>; expects build/strudel.bundle.js and build/golden.json (js/bundle.mjs, js/golden.mjs).

#include <algorithm>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <vector>

#include <nlohmann/json.hpp>

#include "../../../tests/test_harness.h"
#include "StrudelHost.h"

namespace fs = std::filesystem;
using nlohmann::json;

namespace {

fs::path g_root;

std::string readFile(const fs::path& p) {
    std::ifstream in(p, std::ios::binary);
    std::stringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

double nowMs() {
    using namespace std::chrono;
    return duration<double, std::milli>(steady_clock::now().time_since_epoch()).count();
}

// Numbers within 1e-9, everything else exact; a key one side omits must be omitted by the other.
bool sameValue(const json& a, const json& b) {
    if (a.is_number() && b.is_number()) return std::fabs(a.get<double>() - b.get<double>()) < 1e-9;
    if (a.is_object() && b.is_object()) {
        if (a.size() != b.size()) return false;
        for (auto it = a.begin(); it != a.end(); ++it)
            if (!b.contains(it.key()) || !sameValue(*it, b.at(it.key()))) return false;
        return true;
    }
    if (a.is_array() && b.is_array()) {
        if (a.size() != b.size()) return false;
        for (size_t i = 0; i < a.size(); ++i)
            if (!sameValue(a[i], b[i])) return false;
        return true;
    }
    return a == b;
}

const double kWindows[3][2] = {{0, 1}, {0, 8}, {3.25, 3.75}};

std::unique_ptr<StrudelHost> freshHost(double* bootMs = nullptr) {
    auto host = std::make_unique<StrudelHost>();
    std::string err;
    const double t0 = nowMs();
    const bool ok = host->loadBundle(readFile(g_root / "build" / "strudel.bundle.js"), err);
    if (bootMs) *bootMs = nowMs() - t0;
    if (!ok) std::printf("  bundle failed: %s\n", err.c_str());
    return ok ? std::move(host) : nullptr;
}

void parityWithNode() {
    const json golden = json::parse(readFile(g_root / "build" / "golden.json"));
    double bootMs = 0;
    auto host = freshHost(&bootMs);
    CHECK(host != nullptr);
    if (!host) return;
    std::printf("  boot (runtime + bundle): %.1f ms, heap %.1f MiB\n", bootMs, host->memoryBytes() / 1048576.0);

    for (auto it = golden.begin(); it != golden.end(); ++it) {
        std::string err;
        const double t0 = nowMs();
        const bool loaded = host->loadPattern(readFile(g_root / "corpus" / it.key()), err);
        const double loadMs = nowMs() - t0;
        CHECK(loaded);
        if (!loaded) {
            std::printf("  %s: load failed: %s\n", it.key().c_str(), err.c_str());
            continue;
        }
        bool same = true;
        size_t events = 0;
        for (int w = 0; w < 3; ++w) {
            const json got = json::parse(host->queryJson(kWindows[w][0], kWindows[w][1], err));
            events += got.size();
            if (!sameValue(got, it.value()[w])) {
                same = false;
                std::printf("  %s window %d differs\n    qjs:  %s\n    node: %s\n", it.key().c_str(), w,
                            got.dump().c_str(), it.value()[w].dump().c_str());
            }
        }
        CHECK(same);
        std::printf("  %-26s load %6.2f ms  %3zu events  %s\n", it.key().c_str(), loadMs, events,
                    same ? "== node" : "DIFFERS");
    }
}

// The clock's shape: 150 ms ticks at 120 bpm 4/4 ask for ~0.075 cycles each, a little ahead of the playhead.
void clockShapedQueries() {
    auto host = freshHost();
    if (!host) return;
    std::string err;
    CHECK(host->loadPattern(readFile(g_root / "corpus" / "01-demo.strudel"), err));
    const int n = 20000;
    const double step = 0.075;
    std::vector<double> ms;
    ms.reserve(n);
    for (int i = 0; i < n; ++i) {
        const double t0 = nowMs();
        host->queryJson(i * step, (i + 1) * step, err);
        ms.push_back(nowMs() - t0);
    }
    std::sort(ms.begin(), ms.end());
    double sum = 0;
    for (double v : ms) sum += v;
    std::printf("  %d windows (%.0f cycles): mean %.3f ms  p99 %.3f ms  max %.3f ms  heap %.1f MiB\n", n, n * step,
                sum / n, ms[n * 99 / 100], ms.back(), host->memoryBytes() / 1048576.0);
    CHECK(ms[n * 99 / 100] < 5.0);
}

void runawayLoopIsCutOff() {
    auto host = freshHost();
    if (!host) return;
    std::string err;
    host->setDeadlineMs(100);
    const double t0 = nowMs();
    CHECK(!host->loadPattern("while (true) {}\ns(\"bd\")", err));
    const double took = nowMs() - t0;
    std::printf("  cut off after %.0f ms: %s\n", took, err.substr(0, err.find('\n')).c_str());
    CHECK(took < 500);
}

void allocationBombIsCapped() {
    auto host = freshHost();
    if (!host) return;
    std::string err;
    host->setDeadlineMs(5000);
    CHECK(!host->loadPattern("const a = []; for (;;) a.push(new Array(1e6).fill(1));\ns(\"bd\")", err));
    std::printf("  refused: %s\n", err.substr(0, err.find('\n')).c_str());
    // The runtime survives it: the next good pattern loads and plays.
    CHECK(host->loadPattern("s(\"bd sn\")", err));
    CHECK(json::parse(host->queryJson(0, 1, err)).size() == 2);
}

void badPatternKeepsThePreviousOne() {
    auto host = freshHost();
    if (!host) return;
    std::string err;
    CHECK(host->loadPattern("s(\"bd sn hh\")", err));
    CHECK(!host->loadPattern("s(\"bd sn\"", err));
    std::printf("  syntax error: %s\n", err.substr(0, err.find('\n')).c_str());
    CHECK(json::parse(host->queryJson(0, 1, err)).size() == 3);
}

}  // namespace

int main(int argc, char** argv) {
    g_root = argc > 1 ? fs::path(argv[1]) : fs::current_path();
    RUN(parityWithNode);
    RUN(clockShapedQueries);
    RUN(runawayLoopIsCutOff);
    RUN(allocationBombIsCapped);
    RUN(badPatternKeepsThePreviousOne);
    TEST_MAIN_END();
}
