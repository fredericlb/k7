// MachineJobs_test.cpp — the jobs that only answer, called as the agent calls them: the log seeded
// by its tail and continued by offset, a local path handed back under `raw`, a set list counted,
// and the providers going through the one accessor rather than the file.

#include "MachineJobs.h"
#include "Paths.h"

#include "test_harness.h"

#include <cstdlib>
#include <filesystem>
#include <fstream>

namespace fs = std::filesystem;
using nlohmann::json;
using nlohmann::ordered_json;

namespace {

fs::path scratch()
{
    const auto dir = fs::temp_directory_path() / ("st0-jobs-" + std::to_string(std::rand()));
    fs::create_directories(dir);
#ifdef _WIN32
    _putenv_s("STUDIO_HOME", dir.string().c_str());
#else
    setenv("STUDIO_HOME", dir.c_str(), 1);
#endif
    return dir;
}

std::vector<ordered_json> ask(st0::tunnel::Jobs& jobs, const json& req)
{
    std::vector<ordered_json> replies;
    st0::tunnel::JobContext ctx;
    jobs.at(req["type"].get<std::string>())(req, [&](const ordered_json& r) { replies.push_back(r); }, ctx);
    return replies;
}

st0::MachineAccess fakeAccess(std::vector<std::string>& held)
{
    st0::MachineAccess a;
    a.onnxProviders = [&held](const std::optional<std::vector<std::string>>& set) {
        if (set) held = *set;
        return held;
    };
    return a;
}

void theLogIsSeededThenContinued()
{
    scratch();
    std::ofstream(st0::paths::mergedLog(), std::ios::binary) << "a\nb\nc\n";
    std::vector<std::string> held;
    auto jobs = st0::machineJobs(fakeAccess(held));
    auto seed = ask(jobs, {{"type", "log"}, {"tail", 2}});
    CHECK(seed.size() == 1);
    CHECK(seed[0]["raw"]["offset"] == 6);
    CHECK((seed[0]["raw"]["lines"] == json{"b", "c"}));
    std::ofstream(st0::paths::mergedLog(), std::ios::binary | std::ios::app) << "d\npartial";
    auto next = ask(jobs, {{"type", "log"}, {"offset", 6}});
    CHECK(next[0]["raw"]["offset"] == 8);
    CHECK((next[0]["raw"]["lines"] == json{"d"}));
}

void anAbsentLogIsEmpty()
{
    scratch();
    std::vector<std::string> held;
    auto jobs = st0::machineJobs(fakeAccess(held));
    auto r = ask(jobs, {{"type", "log"}, {"tail", 10}});
    CHECK(r[0]["raw"]["offset"] == 0);
    CHECK(r[0]["raw"]["lines"].empty());
}

void aLocalPathComesBackRaw()
{
    const auto dir = scratch();
    const auto song = dir / "song.flac";
    std::ofstream(song) << "x";
    std::vector<std::string> held;
    auto jobs = st0::machineJobs(fakeAccess(held));
    auto r = ask(jobs, {{"type", "local"}, {"path", st0::paths::utf8(song)}});
    CHECK(r[0]["raw"]["path"] == st0::paths::utf8(song));
    bool threw = false;
    try {
        ask(jobs, {{"type", "local"}, {"path", st0::paths::utf8(dir / "gone.flac")}});
    } catch (const std::exception&) {
        threw = true;
    }
    CHECK(threw);
}

void aSetListIsCounted()
{
    const auto dir = scratch();
    std::ofstream(dir / "one.flac") << "x";
    std::vector<std::string> held;
    auto jobs = st0::machineJobs(fakeAccess(held));
    auto r = ask(jobs, {{"type", "prefetch"},
                        {"files", {st0::paths::utf8(dir / "one.flac"), st0::paths::utf8(dir / "two.flac")}}});
    CHECK(r[0]["type"] == "prefetched");
    CHECK(r[0]["count"] == 1);
}

void providersGoThroughTheAccessor()
{
    scratch();
    std::vector<std::string> held;
    auto jobs = st0::machineJobs(fakeAccess(held));
    auto set = ask(jobs, {{"type", "onnx-providers"}, {"set", {"DML", "cpu", "dml"}}});
    CHECK((set[0]["providers"] == json{"dml", "cpu"}));
    CHECK((held == std::vector<std::string>{"dml", "cpu"}));
    auto read = ask(jobs, {{"type", "onnx-providers"}});
    CHECK((read[0]["providers"] == json{"dml", "cpu"}));
}

}  // namespace

void runMachineJobsTests()
{
    RUN(theLogIsSeededThenContinued);
    RUN(anAbsentLogIsEmpty);
    RUN(aLocalPathComesBackRaw);
    RUN(aSetListIsCounted);
    RUN(providersGoThroughTheAccessor);
}
