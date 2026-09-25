// OnnxSession.cpp — see OnnxSession.h. ONNX Runtime is LOADED at the first separation, not linked:
// a supervisor missing it still starts, runs the engine and holds the tunnel, and only the job says
// what is missing — a link-time dependency would stop the whole process over one feature. Built
// without it (a platform it ships no binary for), every open throws a sentence saying so.

#include "OnnxSession.h"

#include "Paths.h"
#include "SeparationAudio.h"

#include <algorithm>
#include <array>
#include <stdexcept>

#ifdef ST0_WITH_ONNX
#define ORT_API_MANUAL_INIT
#include <onnxruntime_cxx_api.h>
#include "Processes.h"
#include <filesystem>
#include <mutex>
#ifdef _WIN32
#include <dxgi1_6.h>
#else
#include <dlfcn.h>
#endif
#endif

namespace st0::separation {

#ifdef ST0_WITH_ONNX

namespace {

namespace fs = std::filesystem;

using AppendCoreML = OrtStatus*(ORT_API_CALL*)(OrtSessionOptions*, uint32_t);
using AppendDml = OrtStatus*(ORT_API_CALL*)(OrtSessionOptions*, int);

/** The loaded library and the two provider entry points outside the OrtApi table. */
struct Runtime {
    bool ok = false;
    std::string error;
    AppendCoreML coreml = nullptr;
    AppendDml dml = nullptr;
};

/** Where a build or a package puts the library, relative to this executable, then `$STUDIO_ONNXRUNTIME_DIR`. */
std::vector<fs::path> candidateDirs()
{
    std::vector<fs::path> dirs;
    if (const char* env = std::getenv("STUDIO_ONNXRUNTIME_DIR"); env && *env) dirs.push_back(paths::fromUtf8(env));
    const auto exe = process::executablePath();
    if (!exe.empty()) {
        const auto d = exe.parent_path();
        dirs.push_back(d);
        dirs.push_back(d / "onnxruntime");
        dirs.push_back(d / "resources" / "onnxruntime");
        dirs.push_back(d / ".." / "Resources" / "resources" / "onnxruntime");
        dirs.push_back(d / ".." / "lib" / "st0-tray" / "resources" / "onnxruntime");
    }
    return dirs;
}

/** The library file in `dir`, whatever version suffix it carries. */
fs::path libraryIn(const fs::path& dir)
{
#ifdef _WIN32
    return fs::is_regular_file(dir / "onnxruntime.dll") ? dir / "onnxruntime.dll" : fs::path();
#else
    std::error_code ec;
    for (const auto& e : fs::directory_iterator(dir, ec)) {
        const std::string name = e.path().filename().string();
#ifdef __APPLE__
        if (name.rfind("libonnxruntime", 0) == 0 && name.size() > 6 && name.substr(name.size() - 6) == ".dylib") return e.path();
#else
        if (name.rfind("libonnxruntime.so", 0) == 0) return e.path();
#endif
    }
    return {};
#endif
}

const Runtime& runtime()
{
    static Runtime r;
    static std::once_flag once;
    std::call_once(once, [] {
        for (const auto& dir : candidateDirs()) {
            const auto lib = libraryIn(dir);
            if (lib.empty()) continue;
#ifdef _WIN32
            // Its own directory first, so DirectML.dll beside it is the one it gets.
            HMODULE h = LoadLibraryExW(lib.wstring().c_str(), nullptr, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
            auto sym = [h](const char* n) { return h ? reinterpret_cast<void*>(GetProcAddress(h, n)) : nullptr; };
#else
            void* h = dlopen(lib.c_str(), RTLD_NOW | RTLD_LOCAL);
            auto sym = [h](const char* n) { return h ? dlsym(h, n) : nullptr; };
#endif
            if (!h) {
                r.error = "could not load " + paths::utf8(lib);
                continue;
            }
            auto base = reinterpret_cast<const OrtApiBase*(ORT_API_CALL*)()>(sym("OrtGetApiBase"));
            const OrtApi* api = base ? base()->GetApi(ORT_API_VERSION) : nullptr;
            if (!api) {
                r.error = paths::utf8(lib) + " is not a usable ONNX Runtime (API " + std::to_string(ORT_API_VERSION) + ")";
                continue;
            }
            Ort::InitApi(api);
            r.coreml = reinterpret_cast<AppendCoreML>(sym("OrtSessionOptionsAppendExecutionProvider_CoreML"));
            r.dml = reinterpret_cast<AppendDml>(sym("OrtSessionOptionsAppendExecutionProvider_DML"));
            r.ok = true;
            return;
        }
        if (r.error.empty()) r.error = "ONNX Runtime is not installed beside the supervisor";
    });
    return r;
}

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
    const auto& rt = runtime();
    if (!rt.ok) throw std::runtime_error(rt.error);
    // The environment FIRST: appending a provider logs through it, and aborts the process when there is none.
    env();
    std::string failures;
    for (const auto& ep : providers) {
        try {
            Ort::SessionOptions o;
            std::string adapter;
            if (ep == "coreml") {
                if (!rt.coreml) throw std::runtime_error("CoreML is not in this build of ONNX Runtime");
                Ort::ThrowOnError(rt.coreml(o, 0));
            } else if (ep == "dml") {
#ifdef _WIN32
                const auto choice = chooseDml();
                // An integrated GPU is not asked at all: sharing the CPU's memory, it only slows the machine.
                if (choice.integratedOnly) throw std::runtime_error(choice.name + " is integrated, so this machine has no GPU for it");
                if (choice.deviceId >= 0) adapter = " (" + choice.name + ", deviceId " + std::to_string(choice.deviceId) + ")";
                if (!rt.dml) throw std::runtime_error("DirectML is not in this build of ONNX Runtime");
                o.DisableMemPattern();
                o.SetExecutionMode(ORT_SEQUENTIAL);
                Ort::ThrowOnError(rt.dml(o, std::max(0, choice.deviceId)));
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

bool onnxAvailable() { return runtime().ok; }

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
