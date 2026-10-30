// AudioSender.cpp — see AudioSender.h. The frame is the other half of packages/engine-protocol/stream.ts,
// byte for byte: only a listener checks, and a disagreement plays as noise.

#include "AudioSender.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <iostream>
#include <utility>
#include <vector>

namespace studio {

namespace {

constexpr uint32_t kStreamMagic = 0x4c535452;   // "LSTR"
constexpr uint8_t kStreamVersion = 1;
constexpr size_t kStreamHeaderBytes = 32;

// 480 frames = 10 ms at 48 kHz: smaller means more syscalls for the same audio, larger puts its own duration under the latency.
constexpr size_t kBroadcastMaxFrames = 480;

// The sender wakes this often and drains everything waiting — shorter than the frame it sends, so it stays ahead of a late wake-up.
constexpr int kBroadcastTickMs = 5;

// How many frames one pass may send before yielding: ~320 ms of 48 kHz audio against the ~240 one tick produces, a bound only against a burst.
constexpr int kBroadcastFramesPerPass = 32;

// How much may sit unsent for one listener before frames are skipped, about a third of a second of stereo float32.
constexpr size_t kBroadcastMaxQueuedBytes = 512 * 1024;

// Little-endian writes explicitly, rather than memcpy of a struct: the wire order is part of the contract.
void putU32(std::string& out, size_t at, uint32_t v) {
    out[at + 0] = static_cast<char>(v & 0xff);
    out[at + 1] = static_cast<char>((v >> 8) & 0xff);
    out[at + 2] = static_cast<char>((v >> 16) & 0xff);
    out[at + 3] = static_cast<char>((v >> 24) & 0xff);
}

std::string encodeStreamFrame(const EngineHost::BroadcastChunk& chunk, uint32_t seq, double captureMs, uint8_t codec) {
    const int channels = EngineHost::broadcastChannels();
    const size_t count = chunk.frames * static_cast<size_t>(channels);
    const size_t bytesPerSample = codec == AudioSender::kCodecPcm16 ? 2 : 4;
    std::string out(kStreamHeaderBytes + count * bytesPerSample, '\0');

    putU32(out, 0, kStreamMagic);
    out[4] = static_cast<char>(kStreamVersion);
    out[5] = static_cast<char>(channels);
    // 6..7 reserved, already zero
    putU32(out, 8, static_cast<uint32_t>(chunk.sampleRate));
    putU32(out, 12, static_cast<uint32_t>(chunk.frames));
    putU32(out, 16, seq);
    out[20] = static_cast<char>(codec);
    // 21..23 reserved, already zero
    static_assert(sizeof(double) == 8, "the header's captureMs is an IEEE-754 binary64");
    std::memcpy(&out[24], &captureMs, 8);
    if (count == 0) return out;
    if (codec != AudioSender::kCodecPcm16) {
        std::memcpy(&out[kStreamHeaderBytes], chunk.samples.data(), count * 4);
        return out;
    }
    // Clipped to full scale and rounded, written low byte first like the rest of the header.
    for (size_t i = 0; i < count; ++i) {
        const float x = std::clamp(chunk.samples[i], -1.0f, 1.0f);
        const auto v = static_cast<int16_t>(std::lround(x * 32767.0f));
        const auto u = static_cast<uint16_t>(v);
        out[kStreamHeaderBytes + 2 * i] = static_cast<char>(u & 0xff);
        out[kStreamHeaderBytes + 2 * i + 1] = static_cast<char>((u >> 8) & 0xff);
    }
    return out;
}

}  // namespace

AudioSender::AudioSender(ServeContext& ctx, ix::WebSocketServer& server, std::function<double()> sinceBoot)
    : ctx_(ctx), server_(server), sinceBoot_(std::move(sinceBoot)) {}

AudioSender::~AudioSender() {
    stop();
    join();
}

void AudioSender::start(std::function<void()> onTick) {
    onTick_ = std::move(onTick);
    running_.store(true, std::memory_order_relaxed);
    thread_ = std::thread([this] { run(); });
}

void AudioSender::join() {
    if (thread_.joinable()) thread_.join();
}

void AudioSender::markArrived(const std::string& session) {
    std::lock_guard<std::mutex> lk(arrivedMx_);
    arrived_.insert(session);
}

void AudioSender::pump(const std::string& sid, const std::vector<Target>& targets) {
    // Drain everything waiting, not one frame per pass: a ceiling equal to the production rate has NO headroom.
    for (int guard = 0; guard < kBroadcastFramesPerPass; ++guard) {
        auto chunk = ctx_.host.drainBroadcast(sid, kBroadcastMaxFrames);
        if (chunk.frames == 0) break;

        // A rate of 0 means this session's tap has never been through initialise(), and stream.ts rejects it, so it would vanish in silence.
        if (chunk.sampleRate < 8000.0) {
            if (warnedNoRate_.insert(sid).second)
                std::cerr << "[broadcast] the tap on '" << sid << "' has no sample rate "
                             "yet — frames withheld until the graph has prepared it\n";
            break;
        }

        // A hole the tap overwrote becomes a JUMP in the sequence number, so the listener re-cushions; rounded UP.
        const uint32_t seq = nextSeq(
            sid, 1 + static_cast<uint32_t>((chunk.lostFrames + kBroadcastMaxFrames - 1) / kBroadcastMaxFrames));
        const double captureMs = sinceBoot_();
        // Each codec encoded once per frame, and only if some listener asked for it.
        std::string f32, pcm16;
        const auto payloadFor = [&](uint8_t codec) -> const std::string& {
            const bool half = codec == kCodecPcm16;
            auto& p = half ? pcm16 : f32;
            if (p.empty()) p = encodeStreamFrame(chunk, seq, captureMs, half ? kCodecPcm16 : kCodecPcmF32);
            return p;
        };

        // Sent OUTSIDE the listener lock, since this send blocks and holding the lock would stall every connection thread.
        for (const auto& t : targets) {
            if (t.socket->bufferedAmount() > kBroadcastMaxQueuedBytes) continue;
            t.socket->sendBinary(payloadFor(t.codec));
        }
        if (chunk.frames < kBroadcastMaxFrames) break;   // ring is empty
    }
}

void AudioSender::run() {
    // When the stale-counter sweep last asked the registry, so a session without listeners costs a lock once a second.
    auto lastRetire = std::chrono::steady_clock::time_point{};

    while (running_.load(std::memory_order_relaxed)) {
        if (onTick_) onTick_();

        // A session whose first listener just arrived starts from LIVE, honoured here because moving a read cursor belongs to this thread alone.
        {
            std::set<std::string> justArrived;
            {
                std::lock_guard<std::mutex> a(arrivedMx_);
                justArrived.swap(arrived_);
            }
            for (const auto& sid : justArrived) ctx_.host.skipBroadcastToLive(sid);
        }

        // WHO IS LISTENING TO WHAT: a session's audio goes only to the sockets listening to that session.
        std::map<std::string, std::vector<Target>> bySession;
        {
            const auto clients = server_.getClients();
            std::lock_guard<std::mutex> lk(ctx_.listenersMx);
            // Prune the departed FIRST: keyed by raw pointer, an entry left by a Close that never arrived could match a later socket.
            for (auto it = ctx_.listeners.begin(); it != ctx_.listeners.end();) {
                const bool live = std::any_of(clients.begin(), clients.end(),
                                              [&](const std::shared_ptr<ix::WebSocket>& c) { return c.get() == it->first; });
                if (!live) ctx_.listenerCodecs.erase(it->first);
                it = live ? std::next(it) : ctx_.listeners.erase(it);
            }
            for (auto& client : clients)
                if (auto hit = ctx_.listeners.find(client.get()); hit != ctx_.listeners.end()) {
                    const auto codec = ctx_.listenerCodecs.find(client.get());
                    bySession[hit->second].push_back(
                        {client, codec == ctx_.listenerCodecs.end() ? kCodecPcmF32 : codec->second});
                }
        }

        for (const auto& [sid, targets] : bySession) pump(sid, targets);

        // Retire the counters of sessions the ENGINE has forgotten, never of ones merely unheard (docs/broadcast.md) — once a second, since asking takes the registry's lock.
        const auto now = std::chrono::steady_clock::now();
        if (seq_.size() > bySession.size() && now - lastRetire >= std::chrono::seconds(1)) {
            lastRetire = now;
            std::set<std::string> live;
            for (const auto& sid : ctx_.host.sessionIds()) live.insert(sid);
            for (auto it = seq_.begin(); it != seq_.end();)
                it = live.count(it->first) ? std::next(it) : seq_.erase(it);
            for (auto it = warnedNoRate_.begin(); it != warnedNoRate_.end();)
                it = live.count(*it) ? std::next(it) : warnedNoRate_.erase(it);
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(kBroadcastTickMs));
    }
}

}  // namespace studio
