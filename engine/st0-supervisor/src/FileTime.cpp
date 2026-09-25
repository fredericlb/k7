// FileTime.cpp — see FileTime.h. The platform calls rather than std::filesystem's clock, whose epoch
// differs by standard library and whose conversion to system time is not everywhere yet.

#include "FileTime.h"

#ifdef _WIN32
#include <windows.h>
#else
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/time.h>
#endif

namespace st0::filetime {

#ifdef _WIN32
namespace {
// 100-ns intervals between 1601-01-01 and 1970-01-01.
constexpr std::uint64_t kEpochDelta = 116444736000000000ULL;
}  // namespace

std::optional<Info> stat(const std::filesystem::path& p)
{
    WIN32_FILE_ATTRIBUTE_DATA d;
    if (!GetFileAttributesExW(p.wstring().c_str(), GetFileExInfoStandard, &d)) return std::nullopt;
    Info i;
    i.isDir = (d.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
    i.isFile = !i.isDir;
    i.size = (std::uint64_t(d.nFileSizeHigh) << 32) | d.nFileSizeLow;
    const std::uint64_t t = (std::uint64_t(d.ftLastWriteTime.dwHighDateTime) << 32) | d.ftLastWriteTime.dwLowDateTime;
    i.mtimeMs = static_cast<double>(t - kEpochDelta) / 10000.0;
    return i;
}

void setMtimeMs(const std::filesystem::path& p, double ms)
{
    HANDLE h = CreateFileW(p.wstring().c_str(), FILE_WRITE_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
                           OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr);
    if (h == INVALID_HANDLE_VALUE) return;
    const std::uint64_t t = static_cast<std::uint64_t>(ms * 10000.0) + kEpochDelta;
    FILETIME ft{static_cast<DWORD>(t & 0xffffffff), static_cast<DWORD>(t >> 32)};
    SetFileTime(h, nullptr, &ft, &ft);
    CloseHandle(h);
}
#else
std::optional<Info> stat(const std::filesystem::path& p)
{
    struct stat st;
    if (::stat(p.c_str(), &st) != 0) return std::nullopt;
    Info i;
    i.isFile = S_ISREG(st.st_mode);
    i.isDir = S_ISDIR(st.st_mode);
    i.size = static_cast<std::uint64_t>(st.st_size);
#ifdef __APPLE__
    i.mtimeMs = st.st_mtimespec.tv_sec * 1000.0 + st.st_mtimespec.tv_nsec / 1e6;
#else
    i.mtimeMs = st.st_mtim.tv_sec * 1000.0 + st.st_mtim.tv_nsec / 1e6;
#endif
    return i;
}

void setMtimeMs(const std::filesystem::path& p, double ms)
{
    timespec ts[2];
    ts[0].tv_sec = ts[1].tv_sec = static_cast<time_t>(ms / 1000);
    ts[0].tv_nsec = ts[1].tv_nsec = static_cast<long>((ms - static_cast<double>(ts[0].tv_sec) * 1000) * 1e6);
    utimensat(AT_FDCWD, p.c_str(), ts, 0);
}
#endif

}  // namespace st0::filetime
