// Http.cpp — see Http.h. `compress` is off: zlib is not built in, and asking for gzip would get a
// body this client cannot read.

#include "Http.h"

#include "TrustRoots.h"

#include <ixwebsocket/IXHttpClient.h>

namespace st0::http {

Response send(const Request& r)
{
    ix::HttpClient client;
    client.setTLSOptions(tls::options());
    auto args = client.createRequest(r.url, r.method);
    args->connectTimeout = r.timeoutSeconds;
    args->transferTimeout = r.timeoutSeconds;
    args->followRedirects = r.followRedirects;
    args->compress = false;
    if (!r.contentType.empty()) args->extraHeaders["Content-Type"] = r.contentType;
    auto res = client.request(r.url, r.method, r.body, args);
    Response out;
    if (!res) {
        out.error = "no response";
        return out;
    }
    if (res->errorCode != ix::HttpErrorCode::Ok) {
        out.error = res->errorMsg.empty() ? "request failed" : res->errorMsg;
        return out;
    }
    out.status = res->statusCode;
    out.body = res->body;
    return out;
}

}  // namespace st0::http
