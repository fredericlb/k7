// PidFile.cpp — see PidFile.h. Each platform reads a process's start time and executable its own way:
// libproc on macOS, sysctl on iOS (whose pidfile only ever names the app), /proc on Linux and Android,
// GetProcessTimes and the image name on Windows.

#include "PidFile.h"

#include "Paths.h"
#include "Platform.h"
#include "Processes.h"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <sstream>

#ifdef _WIN32
#include <windows.h>
#elif defined(K7_IOS)
#include <sys/sysctl.h>
#elif defined(__APPLE__)
#include <libproc.h>
#include <sys/proc_info.h>
#endif

namespace k7::pidfile {

namespace fs = std::filesystem;

namespace {

bool allDigits(const std::string& s)
{
    return !s.empty() && s.size() <= 20 && std::all_of(s.begin(), s.end(), [](unsigned char c) { return std::isdigit(c); });
}

std::string chomp(std::string s)
{
    while (!s.empty() && (s.back() == '\r' || s.back() == '\n' || s.back() == ' ' || s.back() == '\t')) s.pop_back();
    size_t a = 0;
    while (a < s.size() && (s[a] == ' ' || s[a] == '\t')) ++a;
    return s.substr(a);
}

#ifdef _WIN32
std::string utf8Of(const std::wstring& w)
{
    if (w.empty()) return {};
    const int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), nullptr, 0, nullptr, nullptr);
    std::string out(static_cast<size_t>(n), '\0');
    WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), out.data(), n, nullptr, nullptr);
    return out;
}
#endif

}  // namespace

Record parse(const std::string& text)
{
    Record r;
    std::istringstream in(text);
    std::string first;
    if (!std::getline(in, first)) return r;
    first = chomp(first);
    if (!allDigits(first) || first.size() > 9) return r;
    r.pid = std::stoi(first);
    for (std::string line; std::getline(in, line);) {
        line = chomp(line);
        if (line.rfind("start=", 0) == 0 && allDigits(line.substr(6))) r.start = line.substr(6);
        else if (line.rfind("exe=", 0) == 0) r.exe = line.substr(4);
        else if (line.rfind("port=", 0) == 0 && allDigits(line.substr(5)) && line.size() <= 10) {
            const int p = std::stoi(line.substr(5));
            if (p > 0 && p < 65536) r.port = p;
        }
    }
    return r;
}

std::string format(const Record& r)
{
    std::string out = std::to_string(r.pid) + "\n";
    if (!r.start.empty()) out += "start=" + r.start + "\n";
    if (!r.exe.empty()) out += "exe=" + r.exe + "\n";
    if (r.port > 0) out += "port=" + std::to_string(r.port) + "\n";
    return out;
}

bool isEngineExecutable(const std::string& exe)
{
    const size_t slash = exe.find_last_of("/\\");
    std::string name = slash == std::string::npos ? exe : exe.substr(slash + 1);
    std::transform(name.begin(), name.end(), name.begin(), [](unsigned char c) { return std::tolower(c); });
    return name == "k7-runtime" || name == "k7-runtime.exe";
}

Check check(const Record& recorded, const std::optional<Record>& live, bool alive)
{
    if (recorded.pid <= 0 || !alive) return Check::Stale;
    if (!live || live->start.empty() || live->exe.empty()) return Check::Unverified;
    // Whatever the file says, a live process that is not the engine is never ours to adopt or kill.
    if (!isEngineExecutable(live->exe)) return Check::Stale;
    if (!recorded.verified()) return Check::Unverified;
    return recorded.start == live->start ? Check::Same : Check::Stale;
}

std::optional<Record> inspect(int pid)
{
    if (pid <= 0) return std::nullopt;
    Record r;
    r.pid = pid;
#ifdef _WIN32
    HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, static_cast<DWORD>(pid));
    if (!h) return std::nullopt;
    FILETIME created{}, exited{}, kernel{}, user{};
    DWORD code = 0;
    const bool live = GetExitCodeProcess(h, &code) && code == STILL_ACTIVE;
    if (live && GetProcessTimes(h, &created, &exited, &kernel, &user))
        r.start = std::to_string((static_cast<unsigned long long>(created.dwHighDateTime) << 32) | created.dwLowDateTime);
    std::wstring image(32768, L'\0');
    DWORD size = static_cast<DWORD>(image.size());
    if (live && QueryFullProcessImageNameW(h, 0, image.data(), &size)) {
        image.resize(size);
        r.exe = utf8Of(image);
    }
    CloseHandle(h);
    if (!live) return std::nullopt;
#elif defined(K7_IOS)
    kinfo_proc info{};
    size_t len = sizeof info;
    int mib[4] = {CTL_KERN, KERN_PROC, KERN_PROC_PID, pid};
    if (sysctl(mib, 4, &info, &len, nullptr, 0) != 0 || len == 0) return std::nullopt;
    r.start = std::to_string(info.kp_proc.p_starttime.tv_sec);
    if (pid == process::currentPid()) r.exe = process::executablePath().string();
#elif defined(__APPLE__)
    proc_bsdinfo info{};
    if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof info) != static_cast<int>(sizeof info)) return std::nullopt;
    r.start = std::to_string(info.pbi_start_tvsec);
    char path[PROC_PIDPATHINFO_MAXSIZE] = {};
    if (proc_pidpath(pid, path, sizeof path) > 0) r.exe = path;
#else
    std::ifstream stat("/proc/" + std::to_string(pid) + "/stat");
    std::string text;
    if (!std::getline(stat, text)) return std::nullopt;
    // The name in parentheses may hold spaces, so the fields are counted from the LAST ')', which ends field 2.
    const size_t close = text.rfind(')');
    if (close == std::string::npos) return std::nullopt;
    std::istringstream fields(text.substr(close + 1));
    std::string field;
    for (int i = 3; i <= 22 && fields >> field; ++i)
        if (i == 22) r.start = field;
    if (!allDigits(r.start)) r.start.clear();
    std::error_code ec;
    const auto exe = fs::read_symlink("/proc/" + std::to_string(pid) + "/exe", ec);
    if (!ec) r.exe = exe.string();
    // A binary rebuilt under a running engine reads as "<path> (deleted)", and is still that engine.
    if (const std::string gone = " (deleted)"; r.exe.size() > gone.size() && r.exe.compare(r.exe.size() - gone.size(), gone.size(), gone) == 0)
        r.exe.resize(r.exe.size() - gone.size());
#endif
    return r;
}

Record read()
{
    std::ifstream in(paths::enginePid(), std::ios::binary);
    if (!in) return {};
    std::stringstream buf;
    buf << in.rdbuf();
    return parse(buf.str());
}

void write(const Record& r)
{
    std::ofstream(paths::enginePid(), std::ios::binary | std::ios::trunc) << format(r);
}

Record recordOf(int pid)
{
    if (auto live = inspect(pid)) return *live;
    Record r;
    r.pid = pid;
    return r;
}

}  // namespace k7::pidfile
