// TrustRoots.cpp — see TrustRoots.h. macOS: the system anchors plus every certificate an admin or
// the user gave trust settings to (a private CA lands there). Windows: the ROOT stores of the user
// and of the machine. Linux: the distribution's bundle, the first that exists.

#include "TrustRoots.h"

#include <mbedtls/base64.h>

#include <cstdlib>
#include <fstream>
#include <mutex>
#include <sstream>
#include <vector>

#ifdef __APPLE__
#include <Security/Security.h>
#elif defined(_WIN32)
#include <windows.h>
#include <wincrypt.h>
#endif

namespace st0::tls {

namespace {

std::string pemOf(const unsigned char* der, size_t len)
{
    size_t outLen = 0;
    mbedtls_base64_encode(nullptr, 0, &outLen, der, len);
    std::string b64(outLen, '\0');
    if (mbedtls_base64_encode(reinterpret_cast<unsigned char*>(b64.data()), b64.size(), &outLen, der, len) != 0) return {};
    b64.resize(outLen);
    std::string pem = "-----BEGIN CERTIFICATE-----\n";
    for (size_t i = 0; i < b64.size(); i += 64) pem += b64.substr(i, 64) + "\n";
    return pem + "-----END CERTIFICATE-----\n";
}

std::string readFile(const std::string& path)
{
    std::ifstream in(path, std::ios::binary);
    if (!in) return {};
    std::stringstream buf;
    buf << in.rdbuf();
    return buf.str();
}

#ifdef __APPLE__
void appendArray(CFArrayRef certs, std::string& out)
{
    if (!certs) return;
    for (CFIndex i = 0; i < CFArrayGetCount(certs); ++i) {
        auto cert = static_cast<SecCertificateRef>(const_cast<void*>(CFArrayGetValueAtIndex(certs, i)));
        if (CFDataRef der = SecCertificateCopyData(cert)) {
            out += pemOf(CFDataGetBytePtr(der), static_cast<size_t>(CFDataGetLength(der)));
            CFRelease(der);
        }
    }
}

std::string platformRoots()
{
    std::string out;
    CFArrayRef anchors = nullptr;
    if (SecTrustCopyAnchorCertificates(&anchors) == errSecSuccess) {
        appendArray(anchors, out);
        CFRelease(anchors);
    }
    for (auto domain : {kSecTrustSettingsDomainAdmin, kSecTrustSettingsDomainUser}) {
        CFArrayRef certs = nullptr;
        if (SecTrustSettingsCopyCertificates(domain, &certs) == errSecSuccess) {
            appendArray(certs, out);
            CFRelease(certs);
        }
    }
    return out;
}
#elif defined(_WIN32)
void appendStore(DWORD location, std::string& out)
{
    HCERTSTORE store = CertOpenStore(CERT_STORE_PROV_SYSTEM_W, 0, 0, location | CERT_STORE_READONLY_FLAG, L"ROOT");
    if (!store) return;
    PCCERT_CONTEXT ctx = nullptr;
    while ((ctx = CertEnumCertificatesInStore(store, ctx)))
        if (ctx->dwCertEncodingType & X509_ASN_ENCODING) out += pemOf(ctx->pbCertEncoded, ctx->cbCertEncoded);
    CertCloseStore(store, 0);
}

std::string platformRoots()
{
    std::string out;
    appendStore(CERT_SYSTEM_STORE_CURRENT_USER, out);
    appendStore(CERT_SYSTEM_STORE_LOCAL_MACHINE, out);
    return out;
}
#else
std::string platformRoots()
{
    for (const char* path : {"/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt",
                             "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem", "/etc/ssl/ca-bundle.pem",
                             "/etc/ssl/cert.pem"}) {
        std::string pem = readFile(path);
        if (!pem.empty()) return pem;
    }
    return {};
}
#endif

std::once_flag once;
std::string roots;
int count = 0;

}  // namespace

const std::string& rootsPem()
{
    std::call_once(once, [] {
        roots = platformRoots();
        if (const char* extra = std::getenv("STUDIO_EXTRA_CA_CERTS"); extra && *extra) {
            std::string more = readFile(extra);
            if (!more.empty() && more.back() != '\n') more += "\n";
            roots += more;
        }
        for (size_t at = roots.find("-----BEGIN CERTIFICATE-----"); at != std::string::npos;
             at = roots.find("-----BEGIN CERTIFICATE-----", at + 1))
            ++count;
    });
    return roots;
}

int rootCount()
{
    rootsPem();
    return count;
}

ix::SocketTLSOptions options()
{
    ix::SocketTLSOptions o;
    o.tls = true;
    // An empty set would make IXWebSocket fall back to "SYSTEM", which only Windows can read.
    o.caFile = rootsPem().empty() ? "SYSTEM" : rootsPem();
    return o;
}

}  // namespace st0::tls
