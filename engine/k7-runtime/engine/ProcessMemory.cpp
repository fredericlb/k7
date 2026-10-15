// ProcessMemory.cpp — one system call per platform; see ProcessMemory.h and docs/load.md.

#include "ProcessMemory.h"

#if defined(__APPLE__)
#include <mach/mach.h>
#elif defined(_WIN32)
#define NOMINMAX
#include <windows.h>
#include <psapi.h>
#elif defined(__linux__) || defined(__ANDROID__)
#include <cstdio>
#include <unistd.h>
#endif

namespace studio {

int64_t processMemoryBytes() noexcept
{
#if defined(__APPLE__)
    // phys_footprint: dirty and compressed pages this process owns — the figure the OS itself shows.
    task_vm_info_data_t info{};
    mach_msg_type_number_t count = TASK_VM_INFO_COUNT;
    if (task_info(mach_task_self(), TASK_VM_INFO, (task_info_t)&info, &count) != KERN_SUCCESS)
        return -1;
    return (int64_t)info.phys_footprint;
#elif defined(_WIN32)
    // The K32 name lives in kernel32, so nothing extra is linked.
    PROCESS_MEMORY_COUNTERS pmc{};
    if (!K32GetProcessMemoryInfo(GetCurrentProcess(), &pmc, sizeof(pmc))) return -1;
    return (int64_t)pmc.WorkingSetSize;
#elif defined(__linux__) || defined(__ANDROID__)
    // statm's second field is the resident set, in pages.
    FILE* f = std::fopen("/proc/self/statm", "r");
    if (f == nullptr) return -1;
    long size = 0, resident = 0;
    const int got = std::fscanf(f, "%ld %ld", &size, &resident);
    std::fclose(f);
    if (got != 2) return -1;
    return (int64_t)resident * (int64_t)sysconf(_SC_PAGESIZE);
#else
    return -1;
#endif
}

}  // namespace studio
