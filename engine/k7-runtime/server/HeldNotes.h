// HeldNotes.h — the notes a socket's `midi-live` holds down, per session and track, so a socket that
// drops mid-note has them released: a tablet losing Wi-Fi never sends its note-off. JUCE-free and
// header-only, so tests/ has it in a fast binary (docs/protocol.md).
// What reads wrong: the channel is ignored, since the engine plays every live message on channel 1.

#pragma once

#include <cstddef>
#include <cstdint>
#include <map>
#include <mutex>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace studio {

class HeldNotes {
public:
    // The tracks one socket may hold notes on; past it a new track is not followed, which costs at most a hanging note.
    static constexpr std::size_t kMaxTracksPerSocket = 64;

    // What a closed socket leaves to undo on one track: note-offs, then a sustain-up when the pedal was down.
    struct Release {
        std::string session;
        std::string track;
        std::vector<std::vector<std::uint8_t>> messages;
    };

    // One channel message a socket sent to a track, as the engine will play it.
    void sent(const void* socket, const std::string& session, const std::string& track,
              const std::vector<std::uint8_t>& bytes) {
        if (bytes.empty()) return;
        const std::uint8_t kind = bytes[0] & 0xF0;
        std::lock_guard<std::mutex> lock(mx_);
        auto& tracks = bySocket_[socket];
        const auto key = std::make_pair(session, track);
        auto it = tracks.find(key);
        if (it == tracks.end()) {
            if (tracks.size() >= kMaxTracksPerSocket) return;
            it = tracks.emplace(key, Held{}).first;
        }
        Held& h = it->second;
        if (kind == 0x90 && bytes.size() >= 3 && bytes[2] > 0) {
            h.notes.insert(bytes[1] & 0x7F);
        } else if ((kind == 0x80 || kind == 0x90) && bytes.size() >= 2) {
            h.notes.erase(bytes[1] & 0x7F);
        } else if (kind == 0xB0 && bytes.size() >= 3) {
            // CC 64 is the sustain pedal; 120 and 123 end every note, so nothing is left to release.
            if (bytes[1] == 64) h.sustain = bytes[2] >= 64;
            if (bytes[1] == 120 || bytes[1] == 123) h.notes.clear();
        }
    }

    // The socket closed: what it left held, to be played as releases, and it is forgotten.
    std::vector<Release> closed(const void* socket) {
        std::map<std::pair<std::string, std::string>, Held> tracks;
        {
            std::lock_guard<std::mutex> lock(mx_);
            const auto it = bySocket_.find(socket);
            if (it == bySocket_.end()) return {};
            tracks = std::move(it->second);
            bySocket_.erase(it);
        }
        std::vector<Release> out;
        for (const auto& [key, h] : tracks) {
            if (h.notes.empty() && !h.sustain) continue;
            Release r{key.first, key.second, {}};
            for (const std::uint8_t n : h.notes) r.messages.push_back({0x80, n, 0});
            if (h.sustain) r.messages.push_back({0xB0, 64, 0});
            out.push_back(std::move(r));
        }
        return out;
    }

private:
    struct Held {
        std::set<std::uint8_t> notes;
        bool sustain = false;
    };
    std::mutex mx_;
    std::map<const void*, std::map<std::pair<std::string, std::string>, Held>> bySocket_;
};

}  // namespace studio
