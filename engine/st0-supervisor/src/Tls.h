// Tls.h — mbedTLS's process-wide setup, done once before the first socket: the mutexes it locks its
// shared state with, then the PSA random generator every TLS handshake draws from. See
// docs/supervisor.md.

#pragma once

namespace st0::tls {

/** Install the mutex callbacks and seed the generator; call from main, before any other mbedTLS call. */
void init();

}  // namespace st0::tls
