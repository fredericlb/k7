// threading_alt.h — the mutex mbedTLS locks its shared state with, as an opaque pointer so that no
// mbedTLS translation unit has to include windows.h and race the winsock headers. The four callbacks
// behind it are in src/Tls.cpp. Windows only; elsewhere mbedTLS uses its pthread backend.

#ifndef ST0_MBEDTLS_THREADING_ALT_H
#define ST0_MBEDTLS_THREADING_ALT_H

typedef struct mbedtls_threading_mutex_t {
    // Null before init, which is also what mbedTLS's own static mutexes hold until `set_alt` runs.
    void* handle;
} mbedtls_threading_mutex_t;

#endif  // ST0_MBEDTLS_THREADING_ALT_H
