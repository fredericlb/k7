#pragma once

// A deliberately tiny test harness: no framework, no dependency, enough for the vital data-layer tests and
// trivial to swap for Catch2 later. A test is a plain void() run via RUN(); CHECK() records a failure and keeps
// going, so one bad assert doesn't hide the rest, and main() returns non-zero if anything failed.

#include <cstdio>

namespace tdtest {
inline int g_checks = 0;
inline int g_failures = 0;
inline const char* g_current = "";
}  // namespace tdtest

#define CHECK(cond)                                                              \
    do {                                                                         \
        ++::tdtest::g_checks;                                                     \
        if (!(cond)) {                                                            \
            ++::tdtest::g_failures;                                               \
            std::printf("  FAIL [%s] %s:%d: CHECK(%s)\n",                         \
                        ::tdtest::g_current, __FILE__, __LINE__, #cond);         \
        }                                                                        \
    } while (0)

#define RUN(fn)                                                                  \
    do {                                                                         \
        ::tdtest::g_current = #fn;                                                \
        const int before = ::tdtest::g_failures;                                 \
        fn();                                                                     \
        std::printf("%s %s\n", ::tdtest::g_failures == before ? "ok  " : "FAIL", #fn); \
    } while (0)

#define TEST_MAIN_END()                                                          \
    do {                                                                         \
        std::printf("\n%d checks, %d failure(s)\n",                              \
                    ::tdtest::g_checks, ::tdtest::g_failures);                    \
        return ::tdtest::g_failures == 0 ? 0 : 1;                                 \
    } while (0)
