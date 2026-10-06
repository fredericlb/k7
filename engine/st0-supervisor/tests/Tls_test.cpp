// Tls_test.cpp — mbedTLS's PSA state is the PROCESS's: closing one IXWebSocket TLS socket must leave it
// standing for every other socket. It used not to, and concurrent sockets corrupted the heap.

#include <ixwebsocket/IXSocketMbedTLS.h>
#include <psa/crypto.h>

#include <cstdint>

#include "Tls.h"
#include "test_harness.h"

namespace {

void closingOneSocketKeepsTheProcessCryptoUp()
{
    st0::tls::init();
    {
        ix::SocketTLSOptions options;
        ix::SocketMbedTLS socket(options);
        socket.close();
    }
    uint8_t bytes[16] = {};
    // PSA_ERROR_BAD_STATE here is the bug: the close freed what every other socket draws from.
    CHECK(psa_generate_random(bytes, sizeof bytes) == PSA_SUCCESS);
}

}  // namespace

void runTlsTests()
{
    RUN(closingOneSocketKeepsTheProcessCryptoUp);
}
