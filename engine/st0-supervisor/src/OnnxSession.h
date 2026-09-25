// OnnxSession.h — one HT-Demucs session on ONNX Runtime, on the first execution provider that
// builds, and which one won is said. `dml` is pointed at the discrete GPU, never an integrated one,
// since ORT takes an adapter INDEX and says nothing of what it picked. A run can be terminated from
// another thread: that is how a job's hour ends a provider that hangs. See stem-separation/docs/stemSplit.md.

#pragma once

#include <memory>
#include <string>
#include <vector>

namespace st0::separation {

class OnnxSession {
public:
    /** Open `model` on the first of `providers` that loads; throws naming each failure. */
    static std::unique_ptr<OnnxSession> open(const std::string& model, const std::vector<std::string>& providers);
    ~OnnxSession();

    /** One window `[1, 2, kSegment]` in, the stems `[1, 4, 2, kSegment]` out, flat. Throws. */
    std::vector<float> run(const std::vector<float>& mix);

    /** Abort a `run` in progress on another thread; safe to call at any time. */
    void terminate();

    const std::string& provider() const;
    /** ` (name, deviceId N)` for a named GPU, else empty. */
    const std::string& adapter() const;

    /** The providers tried before this one and why each gave way; empty when the first won. */
    const std::string& skipped() const;

private:
    OnnxSession();
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

/** Whether this build carries ONNX Runtime at all. */
bool onnxAvailable();

}  // namespace st0::separation
