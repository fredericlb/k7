#pragma once

// StrudelHost — one QuickJS runtime holding the Strudel bundle and one evaluated pattern; JUCE-free.
// NOT thread-safe and NOT for the audio thread: a PatternPlugin would query it ahead, off the audio thread.

#include <cstddef>
#include <string>

struct JSRuntime;
struct JSContext;

class StrudelHost {
public:
    StrudelHost();
    ~StrudelHost();
    StrudelHost(const StrudelHost&) = delete;
    StrudelHost& operator=(const StrudelHost&) = delete;

    // Evaluates the bundle (build/strudel.bundle.js); false with `error` set if it throws.
    bool loadBundle(const std::string& source, std::string& error);

    // Evaluates one pattern file's source and makes it current; the previous pattern survives a failure.
    bool loadPattern(const std::string& code, std::string& error);

    // The events whose onset lies in [from, to) cycles, as the JSON array entry.js builds.
    std::string queryJson(double from, double to, std::string& error);

    // Bytes the JS heap currently holds.
    std::size_t memoryBytes() const;

    // Wall-clock budget for any one call into JS; a pattern that loops forever is cut off by it.
    void setDeadlineMs(double ms) { deadlineMs_ = ms; }

    // Lines the bundle and patterns wrote through console.*, newest last.
    const std::string& consoleLog() const { return console_; }

private:
    static int interrupt(JSRuntime*, void* opaque);
    bool settle(void* promise, std::string& error);
    void armDeadline();

    JSRuntime* rt_ = nullptr;
    JSContext* ctx_ = nullptr;
    double deadlineMs_ = 250.0;
    double deadlineAt_ = 0.0;
    std::string console_;

    friend struct ConsoleSink;
};
