// mbedtls_user_config.h — appended to mbedTLS's default configuration for this program. DTLS-SRTP
// is off by default, and libdatachannel's DTLS transport configures its profiles even with media
// disabled, so without it the WebRTC path does not link.

#define MBEDTLS_SSL_DTLS_SRTP

// The PSA random generator is one global that TLS sockets on several threads share; Windows has no backend here (docs/supervisor.md).
#if !defined(_WIN32)
#define MBEDTLS_THREADING_C
#define MBEDTLS_THREADING_PTHREAD
#endif
