# patch_ixwebsocket.cmake — run by FetchContent in IXWebSocket's source tree. A TLS write mbedTLS left
# pending (WANT_WRITE) must be retried at the length it was started with; IXWebSocket retries with its
# whole send buffer, which has grown meanwhile, and mbedTLS then counts bytes it never sent as written.
# Idempotent, and fatal when the code it rewrites is not there. See docs/supervisor.md.

set(h_file ixwebsocket/IXSocketMbedTLS.h)
set(c_file ixwebsocket/IXSocketMbedTLS.cpp)
file(READ ${h_file} h)
file(READ ${c_file} c)
if(h MATCHES "_pendingWrite")
    return()
endif()

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
file(WRITE ${h_file} "${h}")
file(WRITE ${c_file} "${c}")
