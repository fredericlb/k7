// mbedtls_user_config.h — appended to mbedTLS's default configuration for this program. DTLS-SRTP
// is off by default, and libdatachannel's DTLS transport configures its profiles even with media
// disabled, so without it the WebRTC path does not link.

#define MBEDTLS_SSL_DTLS_SRTP
