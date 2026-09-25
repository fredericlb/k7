// Separation.cpp — see Separation.h. A job runs on a thread of its own and is POLLED by whoever asked,
// once a second, which is how a second request for the same cut joins the first. An hour ends a job
// whatever it is doing: the run is terminated and the job says why. The rationale for
// every step is stem-separation's docs/stemSplit.md.

#include "Separation.h"

#include "OnnxSession.h"
#include "Paths.h"
#include "Processes.h"
#include "SeparationAudio.h"

#include <mbedtls/sha256.h>

#include <algorithm>
#include <chrono>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <map>
#include <mutex>
#include <sstream>
#include <thread>

namespace st0::separation {

namespace fs = std::filesystem;
using nlohmann::json;
using Clock = std::chrono::steady_clock;

namespace {

constexpr auto kTimeout = std::chrono::hours(1);
constexpr auto kKeep = std::chrono::minutes(5);
constexpr auto kPoll = std::chrono::seconds(1);
constexpr size_t kMaxLines = 50;

struct Job {
    std::mutex mutex;
    json state;
    Clock::time_point at = Clock::now();
    std::shared_ptr<OnnxSession> session;
};

std::mutex registryMutex;
std::map<std::string, std::shared_ptr<Job>> jobs;
/** A provider that lost its device once, for this process's lifetime: the next song starts on the CPU. */
std::string lost;

/** Keyed by the WORK — who, which file, which model, which outputs — never by a workspace. */
std::string jobId(const Request& r, const std::vector<std::string>& outputs)
{
    std::string key = r.user + std::string(1, '\0') + r.source + std::string(1, '\0') + r.model + std::string(1, '\0');
    for (size_t i = 0; i < outputs.size(); ++i) key += (i ? "," : "") + outputs[i];
    unsigned char out[32];
    mbedtls_sha256(reinterpret_cast<const unsigned char*>(key.data()), key.size(), out, 0);
    static const char* digits = "0123456789abcdef";
    std::string h;
    for (int i = 0; i < 8; ++i) {
        h.push_back(digits[out[i] >> 4]);
        h.push_back(digits[out[i] & 15]);
    }
    return h;
}

void sweep()
{
    const auto cutoff = Clock::now() - kKeep;
    for (auto it = jobs.begin(); it != jobs.end();) {
        std::lock_guard lock(it->second->mutex);
        if (it->second->state.value("done", false) && it->second->at < cutoff)
            it = jobs.erase(it);
        else
            ++it;
    }
}

/** Progress, as the worker has news: a phase, a percent (null: no measurable end), and maybe a line. */
void say(Job& job, const std::string& phase, const json& percent, const std::string& line = "")
{
    std::lock_guard lock(job.mutex);
    if (job.state.value("done", false)) return;
    job.state["phase"] = phase;
    job.state["percent"] = percent;
    if (!line.empty()) {
        job.state["lines"].push_back(line);
        if (job.state["lines"].size() > kMaxLines) job.state["lines"].erase(job.state["lines"].begin());
    }
}

void finish(Job& job, const json& patch)
{
    std::lock_guard lock(job.mutex);
    if (job.state.value("done", false)) return;
    for (auto it = patch.begin(); it != patch.end(); ++it) job.state[it.key()] = it.value();
    job.state["done"] = true;
    job.at = Clock::now();
}

/** Decode into the exact shape the model wants, failing HARD: there is no lesser result to fall back to. */
Channels decode(const std::string& source)
{
    const auto ff = process::findTool("ffmpeg");
    const auto r = process::run(ff, {"-hide_banner", "-loglevel", "error", "-i", source, "-f", "f32le", "-acodec", "pcm_f32le", "-ar",
                                     std::to_string(kSampleRate), "-ac", std::to_string(kChannels), "-"});
    if (r.code < 0)
        throw std::runtime_error("ffmpeg is not installed — stem separation decodes its input with it, and unlike a transcode "
                                 "there is no lesser result to fall back to");
    if (r.code != 0) throw std::runtime_error("ffmpeg could not decode " + source + ": " + r.err.substr(r.err.size() > 2048 ? r.err.size() - 2048 : 0));
    std::vector<float> pcm(r.out.size() / sizeof(float));
    std::memcpy(pcm.data(), r.out.data(), pcm.size() * sizeof(float));
    return deinterleave(pcm);
}

/** The record's own rate: a stem only cancels against the record at the rate the record plays. */
std::optional<int> probeRate(const std::string& source)
{
    const auto r = process::run(process::findTool("ffprobe"),
                                {"-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate", "-of", "csv=p=0", source});
    try {
        const int n = std::stoi(r.out);
        return n > 0 ? std::optional<int>(n) : std::nullopt;
    } catch (...) {
        return std::nullopt;
    }
}

/** One output AT the record's rate, resampled through ffmpeg when the model's differs. */
void writeStem(const fs::path& path, const Channels& chans, int to)
{
    if (to == kSampleRate) {
        std::ofstream(path, std::ios::binary | std::ios::trunc) << wavPcm24(chans);
        return;
    }
    const auto inter = interleave(chans);
    const std::string bytes(reinterpret_cast<const char*>(inter.data()), inter.size() * sizeof(float));
    const auto r = process::run(process::findTool("ffmpeg"), {"-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar",
                                                              std::to_string(kSampleRate), "-ac", std::to_string(chans.size()), "-i", "-", "-ar",
                                                              std::to_string(to), "-c:a", "pcm_s24le", "-y", paths::utf8(path)},
                                bytes);
    if (r.code != 0) throw std::runtime_error("ffmpeg could not write " + paths::utf8(path) + ": " + r.err);
}

/** One window's worth of the mix, zero-padded when the file is shorter than a window. */
std::vector<float> windowOf(const Channels& chans, size_t at)
{
    std::vector<float> mix(kChannels * kSegment, 0.f);
    for (size_t c = 0; c < kChannels; ++c) {
        const auto& src = chans[c];
        const size_t n = src.size() > at ? std::min(kSegment, src.size() - at) : 0;
        std::copy_n(src.begin() + static_cast<long>(at), n, mix.begin() + static_cast<long>(c * kSegment));
    }
    return mix;
}

void separate(Job& job, const Request& r, const std::vector<std::string>& outputs, std::vector<std::string> providers)
{
    say(job, "decoding", nullptr);
    const Channels chans = decode(r.source);
    const size_t length = chans.empty() ? 0 : chans[0].size();
    if (!length) throw std::runtime_error(r.source + " decoded to no audio");

    say(job, "loading model", nullptr);
    std::shared_ptr<OnnxSession> session = OnnxSession::open(r.model, providers);
    {
        std::lock_guard lock(job.mutex);
        job.session = session;
    }
    say(job, "separating", 0,
        "execution provider: " + session->provider() + session->adapter() +
            (session->skipped().empty() ? "" : " — skipped " + session->skipped()));

    const auto starts = windowStarts(length);
    OverlapAdd oa(length);
    bool retried = false;
    for (size_t i = 0; i < starts.size(); ++i) {
        const size_t at = starts[i];
        std::vector<float> stems;
        while (stems.empty()) {
            try {
                stems = session->run(windowOf(chans, at));
            } catch (const std::exception& e) {
                if (session->provider() == "cpu") throw;
                // A device lost kills the SESSION rather than the GPU, so the first answer is a fresh one.
                const std::vector<std::string> next = retried ? std::vector<std::string>{"cpu"} : std::vector<std::string>{session->provider()};
                if (retried) {
                    std::lock_guard lock(registryMutex);
                    lost = session->provider();
                }
                std::string first(e.what());
                first = first.substr(0, first.find('\n'));
                say(job, "separating", static_cast<int>(i * 100 / starts.size()),
                    session->provider() + " failed at window " + std::to_string(i + 1) + "/" + std::to_string(starts.size()) + ", " +
                        (retried ? "finishing on cpu" : "retrying on a fresh session") + " — " + first);
                retried = true;
                session = OnnxSession::open(r.model, next);
                std::lock_guard lock(job.mutex);
                job.session = session;
            }
        }
        // `[1, 4, 2, kSegment]`, flat, the stem index outermost — kStems is that order, not a guess.
        for (size_t s = 0; s < kStems.size(); ++s)
            for (size_t c = 0; c < kChannels; ++c) oa.add(at, s, c, stems.data() + (s * kChannels + c) * kSegment, kSegment);
        oa.countWindow(at);
        say(job, "separating", static_cast<int>((i + 1) * 100 / starts.size()));
    }

    say(job, "writing", 100);
    fs::create_directories(paths::fromUtf8(r.outDir));
    const int rate = probeRate(r.source).value_or(kSampleRate);
    if (rate != kSampleRate)
        say(job, "writing", 100, "writing at " + std::to_string(rate) + " Hz, the record's own — the model works at " + std::to_string(kSampleRate));
    json files = json::array();
    for (const auto& name : outputs) {
        const fs::path path = paths::fromUtf8(r.outDir) / (name + ".wav");
        const auto out = outputChannels(oa, name);
        // An overshoot is CLAMPED and SAID: the other way to find out is a click.
        if (const float peak = peakOf(out); peak > 1) {
            char buf[64];
            std::snprintf(buf, sizeof buf, "%s: peak %.3f — clamped to full scale", name.c_str(), peak);
            say(job, "writing", 100, buf);
        }
        writeStem(path, out, rate);
        files.push_back(paths::utf8(path));
    }
    finish(job, {{"files", files}, {"phase", "done"}, {"percent", 100}});
}

}  // namespace

void run(const Request& r, const std::function<void(const nlohmann::json& job)>& report)
{
    std::vector<std::string> outputs = r.outputs;
    if (outputs.empty()) outputs.assign(kStems.begin(), kStems.end());
    for (const auto& o : outputs)
        if (o != kInstrumental && std::find(kStems.begin(), kStems.end(), o) == kStems.end())
            throw std::runtime_error("'" + o + "' is not a separation output");
    const std::string id = jobId(r, outputs);

    std::shared_ptr<Job> job;
    {
        std::lock_guard lock(registryMutex);
        sweep();
        auto it = jobs.find(id);
        if (it != jobs.end() && !it->second->state.value("done", false)) {
            job = it->second;
        } else {
            job = std::make_shared<Job>();
            job->state = {{"id", id},          {"source", r.source}, {"done", false},         {"failed", false}, {"error", nullptr},
                          {"phase", "starting"}, {"percent", nullptr}, {"lines", json::array()}, {"files", json::array()}};
            jobs[id] = job;
            std::vector<std::string> providers = lost.empty() ? r.providers : std::vector<std::string>{"cpu"};
            if (const char* env = std::getenv("STUDIO_ONNX_PROVIDERS"); env && *env) {
                providers.clear();
                std::string s(env);
                for (char& c : s)
                    if (c == ',') c = ' ';
                std::istringstream in(s);
                for (std::string w; in >> w;) providers.push_back(w);
            }
            if (providers.empty()) providers = {"cpu"};
            std::thread([job, r, outputs, providers] {
                try {
                    separate(*job, r, outputs, providers);
                } catch (const std::exception& e) {
                    finish(*job, {{"failed", true}, {"error", e.what()}, {"phase", "failed"}});
                }
            }).detach();
            // The hour: past it the job is failed and its run aborted, whatever it was doing.
            std::thread([job, source = r.source] {
                const auto until = Clock::now() + kTimeout;
                while (Clock::now() < until) {
                    std::this_thread::sleep_for(kPoll);
                    std::lock_guard lock(job->mutex);
                    if (job->state.value("done", false)) return;
                }
                std::shared_ptr<OnnxSession> s;
                {
                    std::lock_guard lock(job->mutex);
                    s = job->session;
                }
                if (s) s->terminate();
                finish(*job, {{"failed", true}, {"error", "separation of " + source + " exceeded 60 minutes"}, {"phase", "failed"}});
            }).detach();
        }
    }

    std::string last;
    for (;;) {
        json snapshot;
        {
            std::lock_guard lock(job->mutex);
            snapshot = job->state;
        }
        const std::string said = snapshot.dump();
        if (said != last) report(snapshot);
        last = said;
        if (snapshot.value("done", false)) return;
        std::this_thread::sleep_for(kPoll);
    }
}

}  // namespace st0::separation
