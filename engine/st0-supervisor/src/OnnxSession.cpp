// OnnxSession.cpp — see OnnxSession.h. Built without ONNX Runtime (a platform it ships no binary
// for), every open throws a sentence saying so, and the job reports it.

#include "OnnxSession.h"

#include "Paths.h"
#include "SeparationAudio.h"

#include <algorithm>
#include <array>
#include <stdexcept>

#ifdef ST0_WITH_ONNX
#include <onnxruntime_cxx_api.h>
#ifdef __APPLE__
#include <coreml_provider_factory.h>
#endif
#ifdef _WIN32
#include <dml_provider_factory.h>
#include <dxgi1_6.h>
#endif
#endif

namespace st0::separation {

#ifdef ST0_WITH_ONNX

namespace {

Ort::Env& env()
{
    static Ort::Env e(ORT_LOGGING_LEVEL_WARNING, "st0-supervisor");
    return e;
}

#ifdef _WIN32
/** Below this much dedicated video memory an adapter is integrated, whatever it calls itself. */
constexpr SIZE_T kDiscreteVram = SIZE_T(1024) * 1024 * 1024;

struct DmlChoice {
    int deviceId = -1;
    std::string name;
    bool integratedOnly = false;
};

std::string narrow(const wchar_t* w)
{
    int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
    std::string s(static_cast<size_t>(n > 0 ? n - 1 : 0), '\0');
    WideCharToMultiByte(CP_UTF8, 0, w, -1, s.data(), n, nullptr, nullptr);
    return s;
}

/** DXGI's own order, which is ORT's index; the first real GPU with video memory of its own wins. */
DmlChoice chooseDml()
{
    DmlChoice c;
    IDXGIFactory1* f = nullptr;
    if (FAILED(CreateDXGIFactory1(__uuidof(IDXGIFactory1), reinterpret_cast<void**>(&f)))) return c;
    std::string firstName;
    IDXGIAdapter1* a = nullptr;
    for (UINT i = 0; f->EnumAdapters1(i, &a) != DXGI_ERROR_NOT_FOUND; ++i) {
        DXGI_ADAPTER_DESC1 d{};
        a->GetDesc1(&d);
        a->Release();
        if (d.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) continue;
        if (firstName.empty()) firstName = narrow(d.Description);
        if (c.deviceId < 0 && d.DedicatedVideoMemory >= kDiscreteVram) {
            c.deviceId = static_cast<int>(i);
            c.name = narrow(d.Description);
        }
    }
    f->Release();
    if (c.deviceId < 0 && !firstName.empty()) {
        c.integratedOnly = true;
        c.name = firstName;
    }
    return c;
}
#endif

}  // namespace

struct OnnxSession::Impl {
    std::unique_ptr<Ort::Session> session;
    Ort::RunOptions runOptions;
    std::string provider;
    std::string adapter;
    std::string skipped;
    std::string input = "mix";
    std::string output;
};

OnnxSession::OnnxSession() : impl_(std::make_unique<Impl>()) {}
OnnxSession::~OnnxSession() = default;

std::unique_ptr<OnnxSession> OnnxSession::open(const std::string& model, const std::vector<std::string>& providers)
{
    // The environment FIRST: appending a provider logs through it, and aborts the process when there is none.
    env();
    std::string failures;
    for (const auto& ep : providers) {
        try {
            Ort::SessionOptions o;
            std::string adapter;
            if (ep == "coreml") {
#ifdef __APPLE__
                Ort::ThrowOnError(OrtSessionOptionsAppendExecutionProvider_CoreML(o, 0));
#else
                throw std::runtime_error("CoreML exists only on macOS");
#endif
            } else if (ep == "dml") {
#ifdef _WIN32
                const auto choice = chooseDml();
                // An integrated GPU is not asked at all: sharing the CPU's memory, it only slows the machine.
                if (choice.integratedOnly) throw std::runtime_error(choice.name + " is integrated, so this machine has no GPU for it");
                if (choice.deviceId >= 0) adapter = " (" + choice.name + ", deviceId " + std::to_string(choice.deviceId) + ")";
                o.DisableMemPattern();
                o.SetExecutionMode(ORT_SEQUENTIAL);
                Ort::ThrowOnError(OrtSessionOptionsAppendExecutionProvider_DML(o, std::max(0, choice.deviceId)));
#else
                throw std::runtime_error("DirectML exists only on Windows");
#endif
            } else if (ep != "cpu") {
                throw std::runtime_error("not in this build");
            }
            // ORTCHAR_T is the platform's path character, wide on Windows.
            auto session = std::make_unique<Ort::Session>(env(), paths::fromUtf8(model).c_str(), o);
            auto s = std::unique_ptr<OnnxSession>(new OnnxSession());
            Ort::AllocatorWithDefaultOptions alloc;
            s->impl_->output = session->GetOutputNameAllocated(0, alloc).get();
            for (size_t i = 0; i < session->GetOutputCount(); ++i)
                if (std::string(session->GetOutputNameAllocated(i, alloc).get()) == "stems") s->impl_->output = "stems";
            s->impl_->session = std::move(session);
            s->impl_->provider = ep;
            s->impl_->adapter = adapter;
            s->impl_->skipped = failures;
            return s;
        } catch (const std::exception& e) {
            failures += (failures.empty() ? "" : "; ") + ep + ": " + e.what();
        }
    }
    throw std::runtime_error("no ONNX execution provider would load " + model + " — " + failures);
}

std::vector<float> OnnxSession::run(const std::vector<float>& mix)
{
    auto mem = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
    const std::array<int64_t, 3> dims = {1, kChannels, static_cast<int64_t>(kSegment)};
    auto input = Ort::Value::CreateTensor<float>(mem, const_cast<float*>(mix.data()), mix.size(), dims.data(), dims.size());
    const char* in[] = {impl_->input.c_str()};
    const char* out[] = {impl_->output.c_str()};
    auto result = impl_->session->Run(impl_->runOptions, in, &input, 1, out, 1);
    const float* data = result[0].GetTensorData<float>();
    const size_t n = result[0].GetTensorTypeAndShapeInfo().GetElementCount();
    return std::vector<float>(data, data + n);
}

void OnnxSession::terminate() { impl_->runOptions.SetTerminate(); }

const std::string& OnnxSession::provider() const { return impl_->provider; }
const std::string& OnnxSession::adapter() const { return impl_->adapter; }
const std::string& OnnxSession::skipped() const { return impl_->skipped; }

bool onnxAvailable() { return true; }

#else

struct OnnxSession::Impl {
    std::string empty;
};

OnnxSession::OnnxSession() : impl_(std::make_unique<Impl>()) {}
OnnxSession::~OnnxSession() = default;

std::unique_ptr<OnnxSession> OnnxSession::open(const std::string&, const std::vector<std::string>&)
{
    throw std::runtime_error("this supervisor was built without ONNX Runtime — it ships no binary for this platform");
}

std::vector<float> OnnxSession::run(const std::vector<float>&) { return {}; }
void OnnxSession::terminate() {}
const std::string& OnnxSession::provider() const { return impl_->empty; }
const std::string& OnnxSession::adapter() const { return impl_->empty; }
const std::string& OnnxSession::skipped() const { return impl_->empty; }
bool onnxAvailable() { return false; }

#endif

}  // namespace st0::separation
