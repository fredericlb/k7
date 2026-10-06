# patch_ixwebsocket.cmake — run by FetchContent in IXWebSocket's source tree. Two fixes to IXSocketMbedTLS:
# a TLS write mbedTLS left pending (WANT_WRITE) is retried at the length it was started with, and closing
# one socket no longer frees mbedTLS's PROCESS-WIDE PSA state, which every other socket is still using.
# Each is idempotent, and fatal when the code it rewrites is not there. See docs/supervisor.md.

set(h_file ixwebsocket/IXSocketMbedTLS.h)
set(c_file ixwebsocket/IXSocketMbedTLS.cpp)
file(READ ${h_file} h)
file(READ ${c_file} c)

# ---- the pending write --------------------------------------------------------------------------------
if(NOT h MATCHES "_pendingWrite")
    set(h_old "        std::mutex _mutex;")
    set(h_new "        std::mutex _mutex;\n        // The length of the write mbedTLS holds pending; it must be asked again at exactly that.\n        size_t _pendingWrite = 0;")

    set(c_old "        ssize_t res = mbedtls_ssl_write(&_ssl, (unsigned char*) buf, nbyte);

        if (res > 0)
        {
            return res;
        }
        else if (res == MBEDTLS_ERR_SSL_WANT_READ || res == MBEDTLS_ERR_SSL_WANT_WRITE)
        {
            errno = EWOULDBLOCK;
            return -1;
        }")
    set(c_new "        // A pending record is flushed and reported at the length asked NOW: ask at the one it began with.
        if (_pendingWrite != 0 && nbyte > _pendingWrite) nbyte = _pendingWrite;
        ssize_t res = mbedtls_ssl_write(&_ssl, (unsigned char*) buf, nbyte);

        if (res > 0)
        {
            _pendingWrite = 0;
            return res;
        }
        else if (res == MBEDTLS_ERR_SSL_WANT_READ || res == MBEDTLS_ERR_SSL_WANT_WRITE)
        {
            if (_pendingWrite == 0) _pendingWrite = nbyte;
            errno = EWOULDBLOCK;
            return -1;
        }")

    string(FIND "${h}" "${h_old}" h_at)
    string(FIND "${c}" "${c_old}" c_at)
    if(h_at EQUAL -1 OR c_at EQUAL -1)
        message(FATAL_ERROR "patch_ixwebsocket: IXSocketMbedTLS no longer reads as expected; check the pending-write fix against this version")
    endif()
    string(REPLACE "${h_old}" "${h_new}" h "${h}")
    string(REPLACE "${c_old}" "${c_new}" c "${c}")
endif()

# ---- the process-wide PSA state -----------------------------------------------------------------------
if(NOT c MATCHES "PSA state is the process's")
    set(c_old "#if MBEDTLS_VERSION_MAJOR >= 4 || (MBEDTLS_VERSION_MAJOR == 3 && MBEDTLS_VERSION_MINOR >= 6)
        mbedtls_psa_crypto_free();
#endif
")
    set(c_new "        // Not freed here: the PSA state is the process's, set up once by st0::tls::init (src/Tls.cpp).
")
    string(FIND "${c}" "${c_old}" c_at)
    if(c_at EQUAL -1)
        message(FATAL_ERROR "patch_ixwebsocket: SocketMbedTLS::close no longer reads as expected; check the PSA-free fix against this version")
    endif()
    string(REPLACE "${c_old}" "${c_new}" c "${c}")
endif()

file(WRITE ${h_file} "${h}")
file(WRITE ${c_file} "${c}")
