// LoadGuard.cpp — the markers under `<state>/loading/`, the strikes in `<state>/quarantine.json`, and the
// judgement a starting server makes of what a dead engine left in flight. See LoadGuard.h and docs/crashes.md.

#include "LoadGuard.h"

#include "EngineHost.h"   // studioStatePath, declared JUCE-free for the server

#include <atomic>
#include <iostream>
#include <map>
#include <mutex>

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <cerrno>
#include <csignal>
#include <unistd.h>
#endif

namespace studio {

namespace {

// Two unfinished loads of the same file: one is a kill or a power cut as often as a crash, two in a row is the file.
constexpr int kStrikesToQuarantine = 2;

std::atomic<bool> g_enabled{false};
std::atomic<int> g_counter{0};

struct Entry {
    std::string stamp;
    std::string kind;
    int strikes = 0;
};

std::mutex g_mx;   // the map below and quarantine.json
std::map<std::string, Entry> g_entries;

juce::File markersDir() { return studioStateDir().getChildFile("loading"); }
juce::File quarantineFile() { return studioStateDir().getChildFile("quarantine.json"); }

// What the file IS right now: an update or a replacement changes it, and that lifts a quarantine.
std::string stampOf(const std::string& path) {
    const juce::File f{juce::String(path)};
    const auto size = f.isDirectory() ? 0 : f.getSize();
    return std::to_string(size) + ":" + std::to_string(f.getLastModificationTime().toMilliseconds());
}

long ownPid() {
#if defined(_WIN32)
    return (long)GetCurrentProcessId();
#else
    return (long)getpid();
#endif
}

// A marker of a LIVE process is not a crash: another engine, or a render, is loading right now.
bool pidAlive(long pid) {
    if (pid <= 0) return false;
#if defined(_WIN32)
    HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, (DWORD)pid);
    if (h == nullptr) return false;
    DWORD code = 0;
    const bool alive = GetExitCodeProcess(h, &code) && code == STILL_ACTIVE;
    CloseHandle(h);
    return alive;
#else
    return kill((pid_t)pid, 0) == 0 || errno == EPERM;
#endif
}

// Called with g_mx held.
void save() {
    juce::DynamicObject::Ptr root = new juce::DynamicObject();
    for (const auto& [path, e] : g_entries) {
        juce::DynamicObject::Ptr o = new juce::DynamicObject();
        o->setProperty("stamp", juce::String(e.stamp));
        o->setProperty("kind", juce::String(e.kind));
        o->setProperty("strikes", e.strikes);
        root->setProperty(juce::Identifier(juce::String(path)), juce::var(o.get()));
    }
    if (g_entries.empty()) quarantineFile().deleteFile();
    else quarantineFile().replaceWithText(juce::JSON::toString(juce::var(root.get())));
}

// Called with g_mx held.
void load() {
    g_entries.clear();
    const auto parsed = juce::JSON::parse(quarantineFile());
    if (auto* o = parsed.getDynamicObject())
        for (const auto& p : o->getProperties())
            g_entries[p.name.toString().toStdString()] = Entry{p.value["stamp"].toString().toStdString(),
                                                               p.value["kind"].toString().toStdString(),
                                                               (int)p.value["strikes"]};
}

}  // namespace

juce::File studioStateDir() {
    const auto env = juce::SystemStats::getEnvironmentVariable("STUDIO_HOME", {});
    auto dir = env.isNotEmpty() ? juce::File(env)
                                : juce::File::getSpecialLocation(juce::File::userHomeDirectory).getChildFile(".k7");
    dir.createDirectory();
    return dir;
}

std::string studioStatePath() { return studioStateDir().getFullPathName().toStdString(); }

LoadGuard::LoadGuard(const std::string& kind, const std::string& path) : path_(path) {
    if (!g_enabled.load() || path.empty()) return;
    const auto dir = markersDir();
    dir.createDirectory();
    marker_ = dir.getChildFile(juce::String(ownPid()) + "-" + juce::String(++g_counter) + ".json");
    juce::DynamicObject::Ptr o = new juce::DynamicObject();
    o->setProperty("pid", (juce::int64)ownPid());
    o->setProperty("kind", juce::String(kind));
    o->setProperty("path", juce::String(path));
    // Written through, not left in a buffer: the whole point is that it is on disk when the process dies.
    if (!marker_.replaceWithText(juce::JSON::toString(juce::var(o.get())))) marker_ = juce::File();
}

LoadGuard::~LoadGuard() {
    if (marker_ == juce::File()) return;
    marker_.deleteFile();
    // A load that came back clears a strike against it: the file loads, whatever killed the engine before.
    std::lock_guard<std::mutex> lk(g_mx);
    if (g_entries.erase(path_) > 0) save();
}

void enableLoadGuards() {
    std::lock_guard<std::mutex> lk(g_mx);
    load();
    bool changed = false;
    for (const auto& m : markersDir().findChildFiles(juce::File::findFiles, false, "*.json")) {
        const auto v = juce::JSON::parse(m);
        if (pidAlive((long)(juce::int64)v["pid"]) && (long)(juce::int64)v["pid"] != ownPid()) continue;
        m.deleteFile();
        const auto path = v["path"].toString().toStdString();
        if (path.empty()) continue;
        auto& e = g_entries[path];
        const auto stamp = stampOf(path);
        if (e.stamp != stamp) e = Entry{stamp, v["kind"].toString().toStdString(), 0};
        ++e.strikes;
        changed = true;
        std::cerr << "[load-guard] the last engine died loading " << e.kind << " '" << path << "' (strike "
                  << e.strikes << " of " << kStrikesToQuarantine << ")\n";
    }
    if (changed) save();
    g_enabled.store(true);
}

bool loadQuarantined(const std::string& path, std::string& why) {
    std::lock_guard<std::mutex> lk(g_mx);
    const auto it = g_entries.find(path);
    if (it == g_entries.end() || it->second.strikes < kStrikesToQuarantine) return false;
    // Replaced or updated since: given its chance again, with the strikes forgotten.
    if (it->second.stamp != stampOf(path)) {
        g_entries.erase(it);
        save();
        return false;
    }
    why = it->second.kind + " '" + juce::File(juce::String(path)).getFileName().toStdString() +
          "' crashed the engine the last " + std::to_string(it->second.strikes) +
          " times it was loaded, so it is not loaded — update or replace it, or delete " +
          quarantineFile().getFullPathName().toStdString() + " to try again";
    return true;
}

}  // namespace studio
