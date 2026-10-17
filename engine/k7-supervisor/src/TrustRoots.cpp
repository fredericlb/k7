// TrustRoots.cpp — see TrustRoots.h. macOS: the system anchors plus every certificate an admin or
// the user marked trusted as a root for SSL (a private CA lands there), less any marked "Never Trust".
// Windows: the ROOT stores of the user and of the machine, less the Disallowed stores and any root
// whose usages exclude server auth. Android: one file per CA, the updatable module's set first.
// iOS: no app may list the system's roots, so the bundle the app ships, at `$STUDIO_SYSTEM_CA_CERTS`.
// Linux: the distribution's bundle, the first that exists.

#include "TrustRoots.h"

#include "Platform.h"

#include <mbedtls/base64.h>

#include <cstdlib>
#include <fstream>
#include <mutex>
#include <sstream>
#include <vector>

#if defined(__APPLE__) && !defined(K7_IOS)
#include <Security/Security.h>

#include <map>
#elif defined(_WIN32)
#include <windows.h>
#include <wincrypt.h>

#include <cstring>
#include <set>
#elif defined(__ANDROID__)
#include <filesystem>
#endif

namespace k7::tls {

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

#ifdef K7_IOS
std::string platformRoots()
{
    const char* bundle = std::getenv("STUDIO_SYSTEM_CA_CERTS");
    return bundle && *bundle ? readFile(bundle) : std::string();
}
#elif defined(__APPLE__)
enum class Verdict { None, Trust, Deny };

std::string derOf(SecCertificateRef cert)
{
    std::string out;
    if (CFDataRef der = SecCertificateCopyData(cert)) {
        out.assign(reinterpret_cast<const char*>(CFDataGetBytePtr(der)), static_cast<size_t>(CFDataGetLength(der)));
        CFRelease(der);
    }
    return out;
}

/** Whether a usage constraint's policy is SSL, or absent (every policy). */
bool forSsl(CFDictionaryRef entry)
{
    const void* policy = CFDictionaryGetValue(entry, kSecTrustSettingsPolicy);
    if (!policy) return true;
    CFDictionaryRef props = SecPolicyCopyProperties(static_cast<SecPolicyRef>(const_cast<void*>(policy)));
    if (!props) return false;
    const void* oid = CFDictionaryGetValue(props, kSecPolicyOid);
    const bool ssl = oid && CFGetTypeID(oid) == CFStringGetTypeID() && CFEqual(oid, kSecPolicyAppleSSL);
    CFRelease(props);
    return ssl;
}

/** One domain's verdict on a certificate for TLS: the first entry that applies decides, as the OS reads it. */
Verdict verdictOf(SecCertificateRef cert, SecTrustSettingsDomain domain)
{
    CFArrayRef settings = nullptr;
    if (SecTrustSettingsCopyTrustSettings(cert, domain, &settings) != errSecSuccess || !settings) return Verdict::None;
    Verdict v = Verdict::None;
    // An empty list is "always trust" for every use.
    if (CFArrayGetCount(settings) == 0) v = Verdict::Trust;
    for (CFIndex i = 0; i < CFArrayGetCount(settings) && v == Verdict::None; ++i) {
        const void* item = CFArrayGetValueAtIndex(settings, i);
        if (!item || CFGetTypeID(item) != CFDictionaryGetTypeID()) continue;
        auto entry = static_cast<CFDictionaryRef>(item);
        // Scoped to one application or one hostname: not a trust this process may borrow.
        if (CFDictionaryGetValue(entry, kSecTrustSettingsApplication) || CFDictionaryGetValue(entry, kSecTrustSettingsPolicyString))
            continue;
        if (!forSsl(entry)) continue;
        SInt32 result = kSecTrustSettingsResultTrustRoot;
        if (const void* r = CFDictionaryGetValue(entry, kSecTrustSettingsResult); r && CFGetTypeID(r) == CFNumberGetTypeID())
            CFNumberGetValue(static_cast<CFNumberRef>(r), kCFNumberSInt32Type, &result);
        if (result == kSecTrustSettingsResultTrustRoot || result == kSecTrustSettingsResultTrustAsRoot) v = Verdict::Trust;
        else if (result == kSecTrustSettingsResultDeny) v = Verdict::Deny;
    }
    CFRelease(settings);
    return v;
}

std::string platformRoots()
{
    std::vector<std::string> order;
    std::map<std::string, Verdict> verdicts;
    auto add = [&](const std::string& der, Verdict v) {
        if (der.empty()) return;
        auto [it, fresh] = verdicts.emplace(der, v);
        if (fresh) order.push_back(der);
        else if (v != Verdict::None) it->second = v;
    };
    CFArrayRef anchors = nullptr;
    if (SecTrustCopyAnchorCertificates(&anchors) == errSecSuccess) {
        for (CFIndex i = 0; i < CFArrayGetCount(anchors); ++i)
            add(derOf(static_cast<SecCertificateRef>(const_cast<void*>(CFArrayGetValueAtIndex(anchors, i)))), Verdict::Trust);
        CFRelease(anchors);
    }
    // Admin before user, so the user's own setting is the one that stands, as in the OS.
    for (auto domain : {kSecTrustSettingsDomainAdmin, kSecTrustSettingsDomainUser}) {
        CFArrayRef certs = nullptr;
        if (SecTrustSettingsCopyCertificates(domain, &certs) != errSecSuccess || !certs) continue;
        for (CFIndex i = 0; i < CFArrayGetCount(certs); ++i) {
            auto cert = static_cast<SecCertificateRef>(const_cast<void*>(CFArrayGetValueAtIndex(certs, i)));
            add(derOf(cert), verdictOf(cert, domain));
        }
        CFRelease(certs);
    }
    std::string out;
    for (const auto& der : order)
        if (verdicts[der] == Verdict::Trust)
            out += pemOf(reinterpret_cast<const unsigned char*>(der.data()), der.size());
    return out;
}
#elif defined(_WIN32)
std::string thumbprintOf(PCCERT_CONTEXT ctx)
{
    BYTE hash[20];
    DWORD len = sizeof hash;
    if (!CertGetCertificateContextProperty(ctx, CERT_SHA1_HASH_PROP_ID, hash, &len)) return {};
    return std::string(reinterpret_cast<const char*>(hash), len);
}

/** The thumbprints of what the user and the machine marked untrusted. */
std::set<std::string> disallowed()
{
    std::set<std::string> out;
    for (DWORD location : {CERT_SYSTEM_STORE_CURRENT_USER, CERT_SYSTEM_STORE_LOCAL_MACHINE}) {
        HCERTSTORE store = CertOpenStore(CERT_STORE_PROV_SYSTEM_W, 0, 0, location | CERT_STORE_READONLY_FLAG, L"Disallowed");
        if (!store) continue;
        PCCERT_CONTEXT ctx = nullptr;
        while ((ctx = CertEnumCertificatesInStore(store, ctx)))
            if (auto t = thumbprintOf(ctx); !t.empty()) out.insert(std::move(t));
        CertCloseStore(store, 0);
    }
    return out;
}

/** Whether a root's usages, where it names any, include server authentication. */
bool servesTls(PCCERT_CONTEXT ctx)
{
    DWORD size = 0;
    if (!CertGetEnhancedKeyUsage(ctx, 0, nullptr, &size)) return GetLastError() == static_cast<DWORD>(CRYPT_E_NOT_FOUND);
    std::vector<BYTE> buf(size);
    auto usage = reinterpret_cast<PCERT_ENHKEY_USAGE>(buf.data());
    if (!CertGetEnhancedKeyUsage(ctx, 0, usage, &size)) return false;
    // No identifier and CRYPT_E_NOT_FOUND is "every usage"; no identifier otherwise is "none".
    if (usage->cUsageIdentifier == 0) return GetLastError() == static_cast<DWORD>(CRYPT_E_NOT_FOUND);
    for (DWORD i = 0; i < usage->cUsageIdentifier; ++i)
        if (std::strcmp(usage->rgpszUsageIdentifier[i], szOID_PKIX_KP_SERVER_AUTH) == 0) return true;
    return false;
}

void appendStore(DWORD location, const std::set<std::string>& denied, std::string& out)
{
    HCERTSTORE store = CertOpenStore(CERT_STORE_PROV_SYSTEM_W, 0, 0, location | CERT_STORE_READONLY_FLAG, L"ROOT");
    if (!store) return;
    PCCERT_CONTEXT ctx = nullptr;
    while ((ctx = CertEnumCertificatesInStore(store, ctx))) {
        if (!(ctx->dwCertEncodingType & X509_ASN_ENCODING)) continue;
        if (denied.count(thumbprintOf(ctx)) || !servesTls(ctx)) continue;
        out += pemOf(ctx->pbCertEncoded, ctx->cbCertEncoded);
    }
    CertCloseStore(store, 0);
}

std::string platformRoots()
{
    std::string out;
    const auto denied = disallowed();
    appendStore(CERT_SYSTEM_STORE_CURRENT_USER, denied, out);
    appendStore(CERT_SYSTEM_STORE_LOCAL_MACHINE, denied, out);
    return out;
}
#elif defined(__ANDROID__)
std::string platformRoots()
{
    // Android 14+ updates its CAs through the conscrypt module, so that set wins when it exists.
    for (const char* dir : {"/apex/com.android.conscrypt/cacerts", "/system/etc/security/cacerts"}) {
        std::string pem;
        std::error_code ec;
        for (const auto& entry : std::filesystem::directory_iterator(dir, ec)) {
            // Each file is the PEM followed by a text dump of it: keep the blocks, drop the prose.
            const std::string text = readFile(entry.path().string());
            const std::string begin = "-----BEGIN CERTIFICATE-----", end = "-----END CERTIFICATE-----";
            for (size_t at = text.find(begin); at != std::string::npos; at = text.find(begin, at + 1)) {
                const size_t stop = text.find(end, at);
                if (stop == std::string::npos) break;
                pem += text.substr(at, stop + end.size() - at) + "\n";
            }
        }
        if (!pem.empty()) return pem;
    }
    return {};
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

std::mutex mutex;
bool loaded = false;
std::string roots;
int count = 0;

}  // namespace

const std::string& rootsPem()
{
    std::lock_guard lock(mutex);
    if (loaded) return roots;
    loaded = true;
    roots = platformRoots();
    count = 0;
    if (const char* extra = std::getenv("STUDIO_EXTRA_CA_CERTS"); extra && *extra) {
        std::string more = readFile(extra);
        if (!more.empty() && more.back() != '\n') more += "\n";
        roots += more;
    }
    for (size_t at = roots.find("-----BEGIN CERTIFICATE-----"); at != std::string::npos;
         at = roots.find("-----BEGIN CERTIFICATE-----", at + 1))
        ++count;
    return roots;
}

void forgetRoots()
{
    std::lock_guard lock(mutex);
    loaded = false;
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

}  // namespace k7::tls
