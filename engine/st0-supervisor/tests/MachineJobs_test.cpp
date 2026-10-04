// MachineJobs_test.cpp — the jobs that only answer, called as the agent calls them: the log seeded
// by its tail and continued by offset, a local path handed back under `raw`, a set list counted,
// the providers going through the one accessor rather than the file, an undo's audio sent back,
// and the month after which this machine stops keeping it.

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

// The reply must NAME the file, freshly stamped: that is what makes the channel upload it.
void keptAudioIsSentBackUp()
{
    const auto dir = scratch();
    const auto blob = dir / "1-b0";
    std::ofstream(blob) << "old";
    const auto before = fs::file_time_type::clock::now() - std::chrono::hours(48);
    fs::last_write_time(blob, before);
    std::vector<std::string> held;
    auto jobs = st0::machineJobs(fakeAccess(held));
    auto r = ask(jobs, {{"type", "send-up"}, {"file", st0::paths::utf8(blob)}});
    CHECK(r[0]["type"] == "sent");
    CHECK(r[0]["file"] == st0::paths::utf8(blob));
    CHECK(fs::last_write_time(blob) > before);
    bool threw = false;
    try {
        ask(jobs, {{"type", "send-up"}, {"file", st0::paths::utf8(dir / "gone")}});
    } catch (const std::exception&) {
        threw = true;
    }
    CHECK(threw);
}

void keptHistoryGoesAfterAMonth()
{
    const auto remote = scratch() / "remote";
    const auto kept = remote / "server" / "history-fred" / "song-0123" / "blobs";
    const auto other = remote / "server" / "ws-fred";
    fs::create_directories(kept);
    fs::create_directories(other);
    std::ofstream(kept / "old") << "x";
    std::ofstream(kept / "new") << "x";
    std::ofstream(other / "clip.wav") << "x";
    const auto old = fs::file_time_type::clock::now() - st0::kKeptHistoryTtl - std::chrono::hours(1);
    fs::last_write_time(kept / "old", old);
    fs::last_write_time(other / "clip.wav", old);
    CHECK(st0::purgeKeptHistory(remote) == 1);
    CHECK(!fs::exists(kept / "old"));
    CHECK(fs::exists(kept / "new"));
    // Only what a server asked to KEEP: a workspace copy is not this purge's.
    CHECK(fs::exists(other / "clip.wav"));
}

}  // namespace

void runMachineJobsTests()
{
    RUN(theLogIsSeededThenContinued);
    RUN(anAbsentLogIsEmpty);
    RUN(aLocalPathComesBackRaw);
    RUN(aSetListIsCounted);
    RUN(providersGoThroughTheAccessor);
    RUN(keptAudioIsSentBackUp);
    RUN(keptHistoryGoesAfterAMonth);
}
