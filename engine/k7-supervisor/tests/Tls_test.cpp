// Tls_test.cpp — mbedTLS's PSA state is the PROCESS's: closing one IXWebSocket TLS socket must leave it
// standing for every other socket. It used not to, and concurrent sockets corrupted the heap.

#include <ixwebsocket/IXSocketMbedTLS.h>
#include <psa/crypto.h>

#include <cstdint>

#include "Tls.h"
#include "TrustRoots.h"
#include "test_harness.h"

namespace {

void closingOneSocketKeepsTheProcessCryptoUp()
{
    k7::tls::init();
    {
        ix::SocketTLSOptions options;
        ix::SocketMbedTLS socket(options);
        socket.close();
    }
    uint8_t bytes[16] = {};
    // PSA_ERROR_BAD_STATE here is the bug: the close freed what every other socket draws from.
    CHECK(psa_generate_random(bytes, sizeof bytes) == PSA_SUCCESS);
}

// Filtering the OS stores by their trust settings must still leave the system's own roots.
void theSystemRootsSurviveTheTrustFilter()
{
#if defined(__APPLE__)
    CHECK(k7::tls::rootCount() > 50);
#endif
}

}  // namespace

void runTlsTests()
{
    RUN(closingOneSocketKeepsTheProcessCryptoUp);
    RUN(theSystemRootsSurviveTheTrustFilter);
}
