// Tls.cpp — see Tls.h. CRITICAL_SECTIONs rather than std::mutex, since the type mbedTLS embeds has to
// be C; it is reached through a pointer so cmake/threading_alt.h stays free of windows.h. There is no
// `mbedtls_threading_free_alt` counterpart: we leave by `_Exit`, as main.cpp says.

#include "Tls.h"

#include <mbedtls/threading.h>
#include <psa/crypto.h>

#ifdef _WIN32
#include <new>

#include <windows.h>
#endif

namespace k7::tls {

#ifdef _WIN32
namespace {

void mutexInit(mbedtls_threading_mutex_t* m)
{
    auto* cs = new (std::nothrow) CRITICAL_SECTION;
    // A null handle is the documented failure state: locking it errors rather than taking nothing.
    if (cs && !InitializeCriticalSectionAndSpinCount(cs, 0)) {
        delete cs;
        cs = nullptr;
    }
    m->handle = cs;
}

void mutexFree(mbedtls_threading_mutex_t* m)
{
    if (auto* cs = static_cast<CRITICAL_SECTION*>(m->handle)) {
        DeleteCriticalSection(cs);
        delete cs;
    }
    m->handle = nullptr;
}

int mutexLock(mbedtls_threading_mutex_t* m)
{
    if (!m->handle) return MBEDTLS_ERR_THREADING_MUTEX_ERROR;
    EnterCriticalSection(static_cast<CRITICAL_SECTION*>(m->handle));
    return 0;
}

int mutexUnlock(mbedtls_threading_mutex_t* m)
{
    if (!m->handle) return MBEDTLS_ERR_THREADING_MUTEX_ERROR;
    LeaveCriticalSection(static_cast<CRITICAL_SECTION*>(m->handle));
    return 0;
}

}  // namespace
#endif

void init()
{
#ifdef _WIN32
    // Before psa_crypto_init below: it is itself one of the calls these mutexes guard.
    mbedtls_threading_set_alt(mutexInit, mutexFree, mutexLock, mutexUnlock);
#endif
    psa_crypto_init();
}

}  // namespace k7::tls
