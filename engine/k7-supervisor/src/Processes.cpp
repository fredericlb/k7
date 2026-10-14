// Processes.cpp — see Processes.h. The child's pipes are drained on detached threads until they close:
// a full pipe blocks the writer, so draining is not optional. Windows arguments are quoted by the
// CommandLineToArgvW rules, since CreateProcess takes one string.

#include "Processes.h"

#include <algorithm>
#include <cstdlib>
#include <thread>

#ifdef _WIN32
#include <windows.h>
#else
#include <cerrno>
#include <csignal>
#include <cstring>
#include <fcntl.h>
#include <spawn.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif
extern char** environ;
#endif

namespace k7::process {

namespace {

/** Split a stream into lines, CRLF or LF, the trailing partial line flushed at the end. */
class LineSplitter {
public:
    explicit LineSplitter(std::function<void(const std::string&)> emit) : emit_(std::move(emit)) {}
    void feed(const char* data, size_t n)
    {
        for (size_t i = 0; i < n; ++i) {
            if (data[i] == '\n') {
                if (!rest_.empty() && rest_.back() == '\r') rest_.pop_back();
                emit_(rest_);
                rest_.clear();
            } else {
                rest_.push_back(data[i]);
            }
        }
    }
    void end()
    {
        if (!rest_.empty()) emit_(rest_);
        rest_.clear();
    }

private:
    std::function<void(const std::string&)> emit_;
    std::string rest_;
};

}  // namespace

#ifdef _WIN32

namespace {

std::wstring wide(const std::string& s)
{
    if (s.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring w(static_cast<size_t>(n), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), w.data(), n);
    return w;
}

/** One argument quoted so CommandLineToArgvW gives it back unchanged. */
std::wstring quote(const std::wstring& arg)
{
    if (!arg.empty() && arg.find_first_of(L" \t\"") == std::wstring::npos) return arg;
    std::wstring out = L"\"";
    size_t slashes = 0;
    for (wchar_t c : arg) {
        if (c == L'\\') {
            ++slashes;
            continue;
        }
        if (c == L'"') out.append(slashes * 2 + 1, L'\\');
        else out.append(slashes, L'\\');
        slashes = 0;
        out.push_back(c);
    }
    out.append(slashes * 2, L'\\');
    out.push_back(L'"');
    return out;
}

/** This process's environment with `extra` laid over it, as the double-NUL block CreateProcessW takes. */
std::wstring environmentBlock(const std::map<std::string, std::string>& extra)
{
    std::map<std::wstring, std::wstring> vars;
    if (wchar_t* block = GetEnvironmentStringsW()) {
        for (const wchar_t* p = block; *p; p += wcslen(p) + 1) {
            std::wstring kv(p);
            const size_t eq = kv.find(L'=', 1);
            if (eq != std::wstring::npos) vars[kv.substr(0, eq)] = kv.substr(eq + 1);
        }
        FreeEnvironmentStringsW(block);
    }
    for (const auto& [k, v] : extra) vars[wide(k)] = wide(v);
    std::wstring out;
    for (const auto& [k, v] : vars) {
        out += k + L"=" + v;
        out.push_back(L'\0');
    }
    out.push_back(L'\0');
    return out;
}

void pump(HANDLE h, bool isErr, std::function<void(const std::string&, bool)> onLine)
{
    std::thread([h, isErr, onLine]() {
        LineSplitter split([&](const std::string& l) {
            if (onLine) onLine(l, isErr);
        });
        char buf[4096];
        DWORD n = 0;
        while (ReadFile(h, buf, sizeof buf, &n, nullptr) && n > 0) split.feed(buf, n);
        split.end();
        CloseHandle(h);
    }).detach();
}

}  // namespace

int currentPid() { return static_cast<int>(GetCurrentProcessId()); }

std::filesystem::path executablePath()
{
    std::wstring buf(32768, L'\0');
    const DWORD n = GetModuleFileNameW(nullptr, buf.data(), static_cast<DWORD>(buf.size()));
    if (n == 0 || n >= buf.size()) return {};
    buf.resize(n);
    return std::filesystem::path(buf);
}

bool pidAlive(int pid)
{
    HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, static_cast<DWORD>(pid));
    if (!h) return GetLastError() == ERROR_ACCESS_DENIED;
    DWORD code = 0;
    const bool alive = GetExitCodeProcess(h, &code) && code == STILL_ACTIVE;
    CloseHandle(h);
    return alive;
}

void killTree(int pid)
{
    std::string out;
    runCapture("taskkill", {"/PID", std::to_string(pid), "/T", "/F"}, out);
}

Spawned spawn(const SpawnOptions& opts)
{
    SECURITY_ATTRIBUTES sa{sizeof sa, nullptr, TRUE};
    HANDLE outR, outW, errR, errW;
    if (!CreatePipe(&outR, &outW, &sa, 0) || !CreatePipe(&errR, &errW, &sa, 0))
        return {0, "CreatePipe failed"};
    SetHandleInformation(outR, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(errR, HANDLE_FLAG_INHERIT, 0);

    std::wstring cmd = quote(opts.program.wstring());
    for (const auto& a : opts.args) cmd += L" " + quote(wide(a));
    std::wstring env = environmentBlock(opts.env);

    STARTUPINFOW si{};
    si.cb = sizeof si;
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdInput = nullptr;
    si.hStdOutput = outW;
    si.hStdError = errW;
    PROCESS_INFORMATION pi{};
    const DWORD flags = CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT;
    const BOOL ok = CreateProcessW(nullptr, cmd.data(), nullptr, nullptr, TRUE, flags, env.data(), nullptr, &si, &pi);
    CloseHandle(outW);
    CloseHandle(errW);
    if (!ok) {
        CloseHandle(outR);
        CloseHandle(errR);
        return {0, "CreateProcess failed with " + std::to_string(GetLastError())};
    }
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    pump(outR, false, opts.onLine);
    pump(errR, true, opts.onLine);
    return {static_cast<int>(pi.dwProcessId), ""};
}

bool runCapture(const std::filesystem::path& program, const std::vector<std::string>& args, std::string& out)
{
    SECURITY_ATTRIBUTES sa{sizeof sa, nullptr, TRUE};
    HANDLE r, w;
    if (!CreatePipe(&r, &w, &sa, 0)) return false;
    SetHandleInformation(r, HANDLE_FLAG_INHERIT, 0);
    std::wstring cmd = quote(program.wstring());
    for (const auto& a : args) cmd += L" " + quote(wide(a));
    STARTUPINFOW si{};
    si.cb = sizeof si;
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdOutput = w;
    si.hStdError = w;
    PROCESS_INFORMATION pi{};
    const BOOL ok = CreateProcessW(nullptr, cmd.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi);
    CloseHandle(w);
    if (!ok) {
        CloseHandle(r);
        return false;
    }
    char buf[4096];
    DWORD n = 0;
    while (ReadFile(r, buf, sizeof buf, &n, nullptr) && n > 0) out.append(buf, n);
    CloseHandle(r);
    WaitForSingleObject(pi.hProcess, INFINITE);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    return true;
}

RunResult run(const std::filesystem::path& program, const std::vector<std::string>& args, const std::string& input)
{
    RunResult r;
    SECURITY_ATTRIBUTES sa{sizeof sa, nullptr, TRUE};
    HANDLE inR, inW, outR, outW, errR, errW;
    if (!CreatePipe(&inR, &inW, &sa, 0)) return r;
    if (!CreatePipe(&outR, &outW, &sa, 0)) return r;
    if (!CreatePipe(&errR, &errW, &sa, 0)) return r;
    SetHandleInformation(inW, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(outR, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(errR, HANDLE_FLAG_INHERIT, 0);
    std::wstring cmd = quote(program.wstring());
    for (const auto& a : args) cmd += L" " + quote(wide(a));
    STARTUPINFOW si{};
    si.cb = sizeof si;
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdInput = inR;
    si.hStdOutput = outW;
    si.hStdError = errW;
    PROCESS_INFORMATION pi{};
    const BOOL ok = CreateProcessW(nullptr, cmd.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi);
    CloseHandle(inR);
    CloseHandle(outW);
    CloseHandle(errW);
    if (!ok) {
        CloseHandle(inW);
        CloseHandle(outR);
        CloseHandle(errR);
        return r;
    }
    auto drain = [](HANDLE h, std::string& into) {
        char buf[65536];
        DWORD n = 0;
        while (ReadFile(h, buf, sizeof buf, &n, nullptr) && n > 0) into.append(buf, n);
        CloseHandle(h);
    };
    std::thread outT(drain, outR, std::ref(r.out));
    std::thread errT(drain, errR, std::ref(r.err));
    for (size_t at = 0; at < input.size();) {
        DWORD n = 0;
        const DWORD chunk = static_cast<DWORD>(std::min<size_t>(input.size() - at, 1 << 20));
        if (!WriteFile(inW, input.data() + at, chunk, &n, nullptr) || n == 0) break;
        at += n;
    }
    CloseHandle(inW);
    outT.join();
    errT.join();
    WaitForSingleObject(pi.hProcess, INFINITE);
    DWORD code = 0;
    GetExitCodeProcess(pi.hProcess, &code);
    r.code = static_cast<int>(code);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    return r;
}

std::string joinHostJob()
{
    const char* env = std::getenv("STUDIO_HOST_PID");
    if (!env || !*env) return {};
    const DWORD hostPid = static_cast<DWORD>(std::strtoul(env, nullptr, 10));
    if (hostPid == 0) return "STUDIO_HOST_PID is not a pid";
    HANDLE host = OpenProcess(PROCESS_DUP_HANDLE, FALSE, hostPid);
    if (!host) return "cannot open the host process: " + std::to_string(GetLastError());
    HANDLE job = CreateJobObjectW(nullptr, nullptr);
    if (!job) {
        CloseHandle(host);
        return "CreateJobObject failed with " + std::to_string(GetLastError());
    }
    // Kill-on-close and no breakaway: every process we start joins it, the engine included.
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION info{};
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    SetInformationJobObject(job, JobObjectExtendedLimitInformation, &info, sizeof info);
    // The host's copy FIRST: closing ours before it exists would end the job, and us with it.
    HANDLE inHost = nullptr;
    const BOOL duplicated = DuplicateHandle(GetCurrentProcess(), job, host, &inHost, 0, FALSE, DUPLICATE_SAME_ACCESS);
    CloseHandle(host);
    std::string error;
    if (!duplicated)
        error = "cannot hand the job to the host: " + std::to_string(GetLastError());
    else if (!AssignProcessToJobObject(job, GetCurrentProcess()))
        error = "cannot join the job: " + std::to_string(GetLastError());
    // Only the host's handle remains, so the job lives exactly as long as the host.
    CloseHandle(job);
    return error;
}

#else

namespace {

void pump(int fd, bool isErr, std::function<void(const std::string&, bool)> onLine)
{
    std::thread([fd, isErr, onLine]() {
        LineSplitter split([&](const std::string& l) {
            if (onLine) onLine(l, isErr);
        });
        char buf[4096];
        for (;;) {
            const ssize_t n = read(fd, buf, sizeof buf);
            if (n > 0) split.feed(buf, static_cast<size_t>(n));
            else if (n < 0 && errno == EINTR) continue;
            else break;
        }
        split.end();
        close(fd);
    }).detach();
}

/** A reaper per child: a dead child that nobody waits for stays a zombie, and a zombie reads as alive. */
void reap(pid_t pid)
{
    std::thread([pid]() {
        int status = 0;
        while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {}
    }).detach();
}

std::vector<std::string> environmentWith(const std::map<std::string, std::string>& extra)
{
    std::map<std::string, std::string> vars;
    for (char** e = environ; e && *e; ++e) {
        std::string kv(*e);
        const size_t eq = kv.find('=');
        if (eq != std::string::npos) vars[kv.substr(0, eq)] = kv.substr(eq + 1);
    }
    for (const auto& [k, v] : extra) vars[k] = v;
    std::vector<std::string> out;
    for (const auto& [k, v] : vars) out.push_back(k + "=" + v);
    return out;
}

}  // namespace

int currentPid() { return static_cast<int>(getpid()); }

std::filesystem::path executablePath()
{
    std::error_code ec;
#ifdef __APPLE__
    uint32_t size = 0;
    _NSGetExecutablePath(nullptr, &size);
    std::string buf(size, '\0');
    if (_NSGetExecutablePath(buf.data(), &size) != 0) return {};
    buf.resize(std::strlen(buf.c_str()));
    auto p = std::filesystem::canonical(buf, ec);
#else
    auto p = std::filesystem::read_symlink("/proc/self/exe", ec);
#endif
    return ec ? std::filesystem::path() : p;
}

bool pidAlive(int pid)
{
    if (pid <= 0) return false;
    if (kill(pid, 0) == 0) return true;
    // EPERM: it exists and belongs to someone else — still alive.
    return errno == EPERM;
}

void killTree(int pid)
{
    if (kill(-pid, SIGTERM) != 0) kill(pid, SIGTERM);
}

Spawned spawn(const SpawnOptions& opts)
{
    int out[2], err[2];
    if (pipe(out) != 0) return {0, "pipe failed"};
    if (pipe(err) != 0) {
        close(out[0]);
        close(out[1]);
        return {0, "pipe failed"};
    }
    fcntl(out[0], F_SETFD, FD_CLOEXEC);
    fcntl(err[0], F_SETFD, FD_CLOEXEC);

    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_addopen(&actions, 0, "/dev/null", O_RDONLY, 0);
    posix_spawn_file_actions_adddup2(&actions, out[1], 1);
    posix_spawn_file_actions_adddup2(&actions, err[1], 2);
    posix_spawn_file_actions_addclose(&actions, out[1]);
    posix_spawn_file_actions_addclose(&actions, err[1]);
    posix_spawnattr_t attr;
    posix_spawnattr_init(&attr);
    // Its own process group, so a stop can signal the whole tree rather than the engine alone.
    posix_spawnattr_setflags(&attr, POSIX_SPAWN_SETPGROUP);
    posix_spawnattr_setpgroup(&attr, 0);

    const std::string prog = opts.program.string();
    std::vector<std::string> argStore{prog};
    argStore.insert(argStore.end(), opts.args.begin(), opts.args.end());
    std::vector<char*> argv;
    for (auto& a : argStore) argv.push_back(a.data());
    argv.push_back(nullptr);
    std::vector<std::string> envStore = environmentWith(opts.env);
    std::vector<char*> envp;
    for (auto& e : envStore) envp.push_back(e.data());
    envp.push_back(nullptr);

    pid_t pid = 0;
    const int rc = posix_spawn(&pid, prog.c_str(), &actions, &attr, argv.data(), envp.data());
    posix_spawn_file_actions_destroy(&actions);
    posix_spawnattr_destroy(&attr);
    close(out[1]);
    close(err[1]);
    if (rc != 0) {
        close(out[0]);
        close(err[0]);
        return {0, std::string("posix_spawn failed: ") + std::strerror(rc)};
    }
    reap(pid);
    pump(out[0], false, opts.onLine);
    pump(err[0], true, opts.onLine);
    return {static_cast<int>(pid), ""};
}

bool runCapture(const std::filesystem::path& program, const std::vector<std::string>& args, std::string& out)
{
    int fds[2];
    if (pipe(fds) != 0) return false;
    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_adddup2(&actions, fds[1], 1);
    posix_spawn_file_actions_addclose(&actions, fds[0]);
    posix_spawn_file_actions_addclose(&actions, fds[1]);
    const std::string prog = program.string();
    std::vector<std::string> argStore{prog};
    argStore.insert(argStore.end(), args.begin(), args.end());
    std::vector<char*> argv;
    for (auto& a : argStore) argv.push_back(a.data());
    argv.push_back(nullptr);
    pid_t pid = 0;
    const int rc = posix_spawnp(&pid, prog.c_str(), &actions, nullptr, argv.data(), environ);
    posix_spawn_file_actions_destroy(&actions);
    close(fds[1]);
    if (rc != 0) {
        close(fds[0]);
        return false;
    }
    char buf[4096];
    for (;;) {
        const ssize_t n = read(fds[0], buf, sizeof buf);
        if (n > 0) out.append(buf, static_cast<size_t>(n));
        else if (n < 0 && errno == EINTR) continue;
        else break;
    }
    close(fds[0]);
    int status = 0;
    while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {}
    return true;
}

RunResult run(const std::filesystem::path& program, const std::vector<std::string>& args, const std::string& input)
{
    RunResult r;
    int in[2], out[2], err[2];
    if (pipe(in) != 0) return r;
    if (pipe(out) != 0) return r;
    if (pipe(err) != 0) return r;
    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_adddup2(&actions, in[0], 0);
    posix_spawn_file_actions_adddup2(&actions, out[1], 1);
    posix_spawn_file_actions_adddup2(&actions, err[1], 2);
    for (int fd : {in[0], in[1], out[0], out[1], err[0], err[1]}) posix_spawn_file_actions_addclose(&actions, fd);
    const std::string prog = program.string();
    std::vector<std::string> argStore{prog};
    argStore.insert(argStore.end(), args.begin(), args.end());
    std::vector<char*> argv;
    for (auto& a : argStore) argv.push_back(a.data());
    argv.push_back(nullptr);
    pid_t pid = 0;
    const int rc = posix_spawnp(&pid, prog.c_str(), &actions, nullptr, argv.data(), environ);
    posix_spawn_file_actions_destroy(&actions);
    close(in[0]);
    close(out[1]);
    close(err[1]);
    if (rc != 0) {
        close(in[1]);
        close(out[0]);
        close(err[0]);
        return r;
    }
    auto drain = [](int fd, std::string& into) {
        char buf[65536];
        for (;;) {
            const ssize_t n = read(fd, buf, sizeof buf);
            if (n > 0) into.append(buf, static_cast<size_t>(n));
            else if (n < 0 && errno == EINTR) continue;
            else break;
        }
        close(fd);
    };
    std::thread outT(drain, out[0], std::ref(r.out));
    std::thread errT(drain, err[0], std::ref(r.err));
    // A child that exits early must not kill us with SIGPIPE on the write.
    signal(SIGPIPE, SIG_IGN);
    for (size_t at = 0; at < input.size();) {
        const ssize_t n = write(in[1], input.data() + at, std::min<size_t>(input.size() - at, 1 << 20));
        if (n > 0) at += static_cast<size_t>(n);
        else if (n < 0 && errno == EINTR) continue;
        else break;
    }
    close(in[1]);
    outT.join();
    errT.join();
    int status = 0;
    while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {}
    r.code = WIFEXITED(status) ? WEXITSTATUS(status) : 128;
    return r;
}

std::string joinHostJob()
{
    return {};
}

#endif

std::filesystem::path findTool(const std::string& name)
{
    namespace fs = std::filesystem;
#ifdef _WIN32
    const std::string exe = name + ".exe";
    const char sep = ';';
#else
    const std::string exe = name;
    const char sep = ':';
#endif
    std::vector<fs::path> dirs;
    if (const char* path = std::getenv("PATH")) {
        std::string p(path);
        for (size_t start = 0; start <= p.size();) {
            const size_t end = p.find(sep, start);
            dirs.emplace_back(p.substr(start, end == std::string::npos ? std::string::npos : end - start));
            if (end == std::string::npos) break;
            start = end + 1;
        }
    }
#ifndef _WIN32
    for (const char* extra : {"/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"}) dirs.emplace_back(extra);
#endif
    std::error_code ec;
    for (const auto& d : dirs)
        if (!d.empty() && fs::is_regular_file(d / exe, ec)) return d / exe;
    return fs::path(exe);
}

}  // namespace k7::process
