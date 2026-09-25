// StrudelHost.cpp — the QuickJS side: boot, promise settling, the deadline, and the JSON the bundle answers in.
// `load` is async in Strudel, so a load drains the job queue until its promise settles or the deadline cuts it.

#include "StrudelHost.h"

#include <chrono>

#include <nlohmann/json.hpp>

extern "C" {
#include "quickjs.h"
}

// The bundle, embedded at configure time from engine/strudel/strudel.bundle.js (engine/CMakeLists.txt); NUL-terminated.
extern const char studioStrudelBundle[];
extern const std::size_t studioStrudelBundleSize;

namespace studio {

namespace {

double nowMs() {
    using namespace std::chrono;
    return duration<double, std::milli>(steady_clock::now().time_since_epoch()).count();
}

// The pending exception as "message\nstack", cleared from the context.
std::string takeException(JSContext* ctx) {
    JSValue exc = JS_GetException(ctx);
    std::string out;
    if (const char* s = JS_ToCString(ctx, exc)) {
        out = s;
        JS_FreeCString(ctx, s);
    }
    JSValue stack = JS_GetPropertyStr(ctx, exc, "stack");
    if (JS_IsString(stack))
        if (const char* s = JS_ToCString(ctx, stack)) {
            out += "\n";
            out += s;
            JS_FreeCString(ctx, s);
        }
    JS_FreeValue(ctx, stack);
    JS_FreeValue(ctx, exc);
    return out;
}

// console.* goes nowhere: the bundle announces itself on load, and the engine's log is not the place for it.
JSValue consoleSink(JSContext*, JSValueConst, int, JSValueConst*) { return JS_UNDEFINED; }

// globalThis.st0Strudel.<name>, as a new reference, with `api` set to the object it hangs on.
JSValue apiFunction(JSContext* ctx, const char* name, JSValue& api) {
    JSValue global = JS_GetGlobalObject(ctx);
    api = JS_GetPropertyStr(ctx, global, "st0Strudel");
    JS_FreeValue(ctx, global);
    return JS_GetPropertyStr(ctx, api, name);
}

}  // namespace

StrudelHost::StrudelHost() {
    rt_ = JS_NewRuntime();
    // A pattern is a few MiB of closures at most; the cap only stops a runaway one from eating the machine.
    JS_SetMemoryLimit(rt_, 64 * 1024 * 1024);
    JS_SetInterruptHandler(rt_, &StrudelHost::interrupt, this);
    ctx_ = JS_NewContext(rt_);

    JSValue global = JS_GetGlobalObject(ctx_);
    JSValue console = JS_NewObject(ctx_);
    for (const char* name : {"log", "info", "warn", "error", "debug"})
        JS_SetPropertyStr(ctx_, console, name, JS_NewCFunction(ctx_, &consoleSink, name, 1));
    JS_SetPropertyStr(ctx_, global, "console", console);
    JS_FreeValue(ctx_, global);

    JSValue r = JS_Eval(ctx_, studioStrudelBundle, studioStrudelBundleSize, "strudel.bundle.js",
                        JS_EVAL_TYPE_GLOBAL);
    ready_ = !JS_IsException(r);
    if (!ready_) bootError_ = takeException(ctx_);
    JS_FreeValue(ctx_, r);
}

StrudelHost::~StrudelHost() {
    std::lock_guard<std::mutex> g(lock_);
    JS_UpdateStackTop(rt_);
    JS_FreeContext(ctx_);
    JS_FreeRuntime(rt_);
}

int StrudelHost::interrupt(JSRuntime*, void* opaque) {
    auto* self = static_cast<StrudelHost*>(opaque);
    return self->deadlineAt_ > 0.0 && nowMs() > self->deadlineAt_ ? 1 : 0;
}

bool StrudelHost::loadPattern(const std::string& code, std::string& error) {
    std::lock_guard<std::mutex> g(lock_);
    if (!ready_) {
        error = bootError_;
        return false;
    }
    // The caller's thread may not be the one that created the runtime, and QuickJS measures stack depth from there.
    JS_UpdateStackTop(rt_);
    deadlineAt_ = nowMs() + deadlineMs_;

    JSValue api;
    JSValue load = apiFunction(ctx_, "load", api);
    JSValue arg = JS_NewStringLen(ctx_, code.data(), code.size());
    JSValue promise = JS_Call(ctx_, load, api, 1, &arg);
    JS_FreeValue(ctx_, arg);
    JS_FreeValue(ctx_, load);
    JS_FreeValue(ctx_, api);

    bool ok = !JS_IsException(promise);
    if (!ok) error = takeException(ctx_);
    while (ok) {
        const JSPromiseStateEnum state = JS_PromiseState(ctx_, promise);
        if (state == JS_PROMISE_FULFILLED) break;
        if (state == JS_PROMISE_REJECTED) {
            JS_Throw(ctx_, JS_PromiseResult(ctx_, promise));
            error = takeException(ctx_);
            ok = false;
            break;
        }
        JSContext* jobCtx = nullptr;
        const int ran = JS_ExecutePendingJob(rt_, &jobCtx);
        if (ran <= 0) {
            error = ran < 0 ? takeException(jobCtx ? jobCtx : ctx_) : "pattern never finished evaluating";
            ok = false;
        }
    }
    JS_FreeValue(ctx_, promise);
    deadlineAt_ = 0.0;
    return ok;
}

// One call into the bundle's JSON API, the lock already held: st0Strudel.<fn>(args…) parsed, or null with `error` set.
struct JsonCall {
    static nlohmann::json run(StrudelHost& h, const char* fn, std::vector<JSValue> args, std::string& error) {
        JS_UpdateStackTop(h.rt_);
        h.deadlineAt_ = nowMs() + h.deadlineMs_;
        JSValue api;
        JSValue f = apiFunction(h.ctx_, fn, api);
        JSValue r = JS_Call(h.ctx_, f, api, (int)args.size(), args.data());
        for (auto& a : args) JS_FreeValue(h.ctx_, a);
        JS_FreeValue(h.ctx_, f);
        JS_FreeValue(h.ctx_, api);
        h.deadlineAt_ = 0.0;
        if (JS_IsException(r)) {
            error = takeException(h.ctx_);
            return nullptr;
        }
        size_t len = 0;
        const char* s = JS_ToCStringLen(h.ctx_, &len, r);
        JS_FreeValue(h.ctx_, r);
        if (s == nullptr) return nullptr;
        auto parsed = nlohmann::json::parse(s, s + len, nullptr, false);
        JS_FreeCString(h.ctx_, s);
        return parsed;
    }
};

std::vector<LaneEvent> StrudelHost::laneEvents(double from, double to, const std::string& label, bool catchAll,
                                               const std::vector<std::string>& claimed, std::string& error) {
    std::lock_guard<std::mutex> g(lock_);
    std::vector<LaneEvent> out;
    if (!ready_) return out;
    const std::string claimedJson = nlohmann::json(claimed).dump();
    const auto parsed = JsonCall::run(*this, "laneEventsJson",
                                 {JS_NewFloat64(ctx_, from), JS_NewFloat64(ctx_, to),
                                  JS_NewStringLen(ctx_, label.data(), label.size()), JS_NewBool(ctx_, catchAll),
                                  JS_NewStringLen(ctx_, claimedJson.data(), claimedJson.size())},
                                 error);
    if (!parsed.is_array()) return out;
    out.reserve(parsed.size());
    for (const auto& e : parsed)
        out.push_back({e.value("cycle", 0.0), e.value("dur", 0.0), e.value("key", 60), e.value("vel", 0.9f),
                       e.value("s", std::string{}), e.value("n", 0)});
    return out;
}

std::vector<std::string> StrudelHost::labels(double from, double to) {
    std::lock_guard<std::mutex> g(lock_);
    std::vector<std::string> out;
    if (!ready_) return out;
    std::string error;
    const auto parsed = JsonCall::run(*this, "labelsJson", {JS_NewFloat64(ctx_, from), JS_NewFloat64(ctx_, to)}, error);
    if (parsed.is_array())
        for (const auto& l : parsed)
            if (l.is_string()) out.push_back(l.get<std::string>());
    return out;
}

std::size_t StrudelHost::memoryBytes() {
    std::lock_guard<std::mutex> g(lock_);
    JSMemoryUsage usage{};
    JS_ComputeMemoryUsage(rt_, &usage);
    return static_cast<std::size_t>(usage.memory_used_size);
}

}  // namespace studio
