// SampleBanks.h — a Strudel sound name (+ variant) → the WAV a pattern lane plays, searched in the banks the document
// names, in order. JUCE-free and header-only so tests/ has it in the FAST binary.
// The one thing a reader would get wrong: a name that resolves nowhere is NOT an error — it is a NOTE (docs/patternPlugin.md).

#pragma once

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <map>
#include <mutex>
#include <string>
#include <vector>

namespace studio {

class SampleBanks {
public:
    explicit SampleBanks(std::vector<std::string> dirs = {}) : dirs_(std::move(dirs)) {}

    /** Replaces the banks and forgets every lookup made in the old ones. */
    void setDirs(std::vector<std::string> dirs) {
        std::lock_guard<std::mutex> g(lock_);
        dirs_ = std::move(dirs);
        memo_.clear();
    }

    /** The file for `name`/`index`, or "" — the WAVs in `<bank>/<name>/` sorted and taken modulo, else `<bank>/<name>.wav`. */
    std::string resolve(const std::string& name, int index) {
        if (name.empty()) return {};
        const std::string key = name + "#" + std::to_string(index);
        std::lock_guard<std::mutex> g(lock_);
        if (auto it = memo_.find(key); it != memo_.end()) return it->second;
        std::string found;
        namespace fs = std::filesystem;
        for (const auto& bank : dirs_) {
            const auto wavs = wavsIn(fs::path(bank) / name);
            if (!wavs.empty()) {
                const int n = (int)wavs.size();
                found = wavs[(size_t)(((index % n) + n) % n)];
                break;
            }
            std::error_code ec;
            const auto flat = fs::path(bank) / (name + ".wav");
            if (fs::is_regular_file(flat, ec)) {
                found = flat.string();
                break;
            }
        }
        // Banks do not change under a running lane, so one lookup per name and variant is enough.
        memo_[key] = found;
        return found;
    }

private:
    // The WAVs directly in `dir`, sorted by file name as `samples.ts` sorts them.
    static std::vector<std::string> wavsIn(const std::filesystem::path& dir) {
        std::vector<std::string> names;
        std::error_code ec;
        for (auto it = std::filesystem::directory_iterator(dir, ec);
             !ec && it != std::filesystem::directory_iterator(); it.increment(ec)) {
            const std::string f = it->path().filename().string();
            if (f.size() > 4 && lower(f.substr(f.size() - 4)) == ".wav") names.push_back(f);
        }
        std::sort(names.begin(), names.end());
        std::vector<std::string> out;
        for (const auto& f : names) out.push_back((dir / f).string());
        return out;
    }

    static std::string lower(std::string s) {
        for (auto& c : s) c = (char)std::tolower((unsigned char)c);
        return s;
    }

    std::vector<std::string> dirs_;
    std::mutex lock_;
    std::map<std::string, std::string> memo_;
};

}  // namespace studio
