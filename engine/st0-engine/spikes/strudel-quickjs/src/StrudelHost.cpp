// StrudelHost.cpp — the QuickJS side of StrudelHost: evaluation, promise settling, the deadline and the console.
// `load` is async in Strudel, so every call drains the job queue until its promise settles or the deadline hits.

#include "StrudelHost.h"

#include <chrono>

extern "C" {
#include "quickjs.h"
}

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

}  // namespace

// console.* appends to the host's log instead of a terminal the engine does not have.
struct ConsoleSink {
    static JSValue write(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
        auto* host = static_cast<StrudelHost*>(JS_GetContextOpaque(ctx));
        for (int i = 0; i < argc; ++i) {
            if (const char* s = JS_ToCString(ctx, argv[i])) {
                host->console_ += (i ? " " : "");
                host->console_ += s;
                JS_FreeCString(ctx, s);
            }
        }
        host->console_ += "\n";
        return JS_UNDEFINED;
    }
};

StrudelHost::StrudelHost() {
    rt_ = JS_NewRuntime();
    // A pattern is a few hundred KiB of closures; the cap only stops a runaway one from eating the machine.
    JS_SetMemoryLimit(rt_, 64 * 1024 * 1024);
    JS_SetInterruptHandler(rt_, &StrudelHost::interrupt, this);
    ctx_ = JS_NewContext(rt_);
    JS_SetContextOpaque(ctx_, this);

    JSValue global = JS_GetGlobalObject(ctx_);
    JSValue console = JS_NewObject(ctx_);
    for (const char* name : {"log", "info", "warn", "error", "debug"})
        JS_SetPropertyStr(ctx_, console, name, JS_NewCFunction(ctx_, &ConsoleSink::write, name, 1));
    JS_SetPropertyStr(ctx_, global, "console", console);
    JS_FreeValue(ctx_, global);
}

StrudelHost::~StrudelHost() {
    JS_FreeContext(ctx_);
    JS_FreeRuntime(rt_);
}

int StrudelHost::interrupt(JSRuntime*, void* opaque) {
    auto* self = static_cast<StrudelHost*>(opaque);
    return self->deadlineAt_ > 0.0 && nowMs() > self->deadlineAt_ ? 1 : 0;
}

void StrudelHost::armDeadline() { deadlineAt_ = nowMs() + deadlineMs_; }

bool StrudelHost::loadBundle(const std::string& source, std::string& error) {
    // The bundle is evaluated once, at startup, and is allowed the time a cold parse takes.
    deadlineAt_ = 0.0;
    JSValue r = JS_Eval(ctx_, source.c_str(), source.size(), "strudel.bundle.js", JS_EVAL_TYPE_GLOBAL);
    const bool ok = !JS_IsException(r);
    if (!ok) error = takeException(ctx_);
    JS_FreeValue(ctx_, r);
    return ok;
}

// Runs queued jobs until `promise` is no longer pending; consumes it.
bool StrudelHost::settle(void* promisePtr, std::string& error) {
    JSValue promise = *static_cast<JSValue*>(promisePtr);
    bool ok = true;
    for (;;) {
        const JSPromiseStateEnum state = JS_PromiseState(ctx_, promise);
        if (state == JS_PROMISE_FULFILLED) break;
        if (state == JS_PROMISE_REJECTED) {
            JSValue reason = JS_PromiseResult(ctx_, promise);
            JS_Throw(ctx_, reason);
            error = takeException(ctx_);
            ok = false;
            break;
        }
        JSContext* jobCtx = nullptr;
        const int ran = JS_ExecutePendingJob(rt_, &jobCtx);
        if (ran < 0) {
            error = takeException(jobCtx ? jobCtx : ctx_);
            ok = false;
            break;
        }
        if (ran == 0) {
            error = "promise never settled (nothing left to run)";
            ok = false;
            break;
        }
    }
    JS_FreeValue(ctx_, promise);
    return ok;
}

bool StrudelHost::loadPattern(const std::string& code, std::string& error) {
    armDeadline();
    JSValue global = JS_GetGlobalObject(ctx_);
    JSValue api = JS_GetPropertyStr(ctx_, global, "strudelSpike");
    JSValue load = JS_GetPropertyStr(ctx_, api, "load");
    JSValue arg = JS_NewStringLen(ctx_, code.data(), code.size());
    JSValue promise = JS_Call(ctx_, load, api, 1, &arg);
    JS_FreeValue(ctx_, arg);
    JS_FreeValue(ctx_, load);
    JS_FreeValue(ctx_, api);
    JS_FreeValue(ctx_, global);
    bool ok;
    if (JS_IsException(promise)) {
        error = takeException(ctx_);
        ok = false;
    } else {
        ok = settle(&promise, error);
    }
    deadlineAt_ = 0.0;
    return ok;
}

std::string StrudelHost::queryJson(double from, double to, std::string& error) {
    armDeadline();
    JSValue global = JS_GetGlobalObject(ctx_);
    JSValue api = JS_GetPropertyStr(ctx_, global, "strudelSpike");
    JSValue fn = JS_GetPropertyStr(ctx_, api, "queryJson");
    JSValue args[2] = {JS_NewFloat64(ctx_, from), JS_NewFloat64(ctx_, to)};
    JSValue r = JS_Call(ctx_, fn, api, 2, args);
    std::string out;
    if (JS_IsException(r)) {
        error = takeException(ctx_);
    } else if (const char* s = JS_ToCString(ctx_, r)) {
        out = s;
        JS_FreeCString(ctx_, s);
    }
    JS_FreeValue(ctx_, r);
    JS_FreeValue(ctx_, fn);
    JS_FreeValue(ctx_, api);
    JS_FreeValue(ctx_, global);
    deadlineAt_ = 0.0;
    return out;
}

std::size_t StrudelHost::memoryBytes() const {
    JSMemoryUsage usage{};
    JS_ComputeMemoryUsage(rt_, &usage);
    return static_cast<std::size_t>(usage.memory_used_size);
}
