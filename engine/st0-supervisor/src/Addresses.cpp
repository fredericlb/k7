// Addresses.cpp — see Addresses.h. The fingerprint is sha256(`host|macs`), MACs lowercase with
// colons, sorted and deduplicated — the spelling Node's os.networkInterfaces gave, so an engine keeps
// its fingerprint across the change of supervisor.

#include "Addresses.h"

#include <mbedtls/sha256.h>

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <iterator>
#include <regex>
#include <set>

#ifdef _WIN32
#include <winsock2.h>
#include <iphlpapi.h>
#include <ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <ifaddrs.h>
#include <net/if.h>
#include <netinet/in.h>
#include <unistd.h>
#ifdef __APPLE__
#include <net/if_dl.h>
#else
#include <netpacket/packet.h>
#endif
#endif

namespace st0::addresses {

namespace {

struct Iface {
    std::string name;
    std::vector<std::string> ipv4;
    std::string mac;
    bool internal = false;
    /** Carries an IPv4 or IPv6 address — only those are listed by Node, and so fingerprinted. */
    bool addressed = false;
};

std::string macString(const unsigned char* b, size_t n)
{
    char buf[4];
    std::string out;
    for (size_t i = 0; i < n; ++i) {
        std::snprintf(buf, sizeof buf, "%02x", b[i]);
        if (i) out += ":";
        out += buf;
    }
    return out;
}

#ifdef _WIN32
std::string narrow(const wchar_t* w)
{
    if (!w) return {};
    int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
    std::string s(static_cast<size_t>(n > 0 ? n - 1 : 0), '\0');
    WideCharToMultiByte(CP_UTF8, 0, w, -1, s.data(), n, nullptr, nullptr);
    return s;
}

std::vector<Iface> interfaces()
{
    std::vector<Iface> out;
    ULONG size = 16 * 1024;
    std::vector<unsigned char> buf(size);
    auto* list = reinterpret_cast<IP_ADAPTER_ADDRESSES*>(buf.data());
    if (GetAdaptersAddresses(AF_UNSPEC, GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER, nullptr,
                             list, &size) == ERROR_BUFFER_OVERFLOW) {
        buf.resize(size);
        list = reinterpret_cast<IP_ADAPTER_ADDRESSES*>(buf.data());
        if (GetAdaptersAddresses(AF_UNSPEC, GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER,
                                 nullptr, list, &size) != NO_ERROR)
            return out;
    }
    for (auto* a = list; a; a = a->Next) {
        if (a->OperStatus != IfOperStatusUp) continue;
        Iface f;
        f.name = narrow(a->FriendlyName);
        f.internal = a->IfType == IF_TYPE_SOFTWARE_LOOPBACK;
        f.addressed = a->FirstUnicastAddress != nullptr;
        if (a->PhysicalAddressLength) f.mac = macString(a->PhysicalAddress, a->PhysicalAddressLength);
        for (auto* u = a->FirstUnicastAddress; u; u = u->Next)
            if (u->Address.lpSockaddr->sa_family == AF_INET) {
                char ip[INET_ADDRSTRLEN];
                auto* sin = reinterpret_cast<sockaddr_in*>(u->Address.lpSockaddr);
                inet_ntop(AF_INET, &sin->sin_addr, ip, sizeof ip);
                f.ipv4.push_back(ip);
            }
        out.push_back(f);
    }
    return out;
}
#else
std::vector<Iface> interfaces()
{
    std::vector<Iface> out;
    ifaddrs* list = nullptr;
    if (getifaddrs(&list) != 0) return out;
    auto find = [&](const std::string& name) -> Iface& {
        for (auto& f : out)
            if (f.name == name) return f;
        out.push_back({name, {}, "", false, false});
        return out.back();
    };
    for (auto* a = list; a; a = a->ifa_next) {
        // Up AND running, as libuv lists them: an interface that is merely up reaches nobody.
        if (!a->ifa_addr || !(a->ifa_flags & IFF_UP) || !(a->ifa_flags & IFF_RUNNING)) continue;
        Iface& f = find(a->ifa_name);
        if (a->ifa_flags & IFF_LOOPBACK) f.internal = true;
        if (a->ifa_addr->sa_family == AF_INET6) f.addressed = true;
        if (a->ifa_addr->sa_family == AF_INET) {
            f.addressed = true;
            char ip[INET_ADDRSTRLEN];
            inet_ntop(AF_INET, &reinterpret_cast<sockaddr_in*>(a->ifa_addr)->sin_addr, ip, sizeof ip);
            f.ipv4.push_back(ip);
        }
#ifdef __APPLE__
        if (a->ifa_addr->sa_family == AF_LINK) {
            auto* sdl = reinterpret_cast<sockaddr_dl*>(a->ifa_addr);
            if (sdl->sdl_alen == 6) f.mac = macString(reinterpret_cast<unsigned char*>(LLADDR(sdl)), 6);
        }
#else
        if (a->ifa_addr->sa_family == AF_PACKET) {
            auto* ll = reinterpret_cast<sockaddr_ll*>(a->ifa_addr);
            if (ll->sll_halen == 6) f.mac = macString(ll->sll_addr, 6);
        }
#endif
    }
    freeifaddrs(list);
    return out;
}
#endif

std::string hostName()
{
    // Android answers "localhost" for every phone, so its app names the device instead.
    if (const char* named = std::getenv("STUDIO_MACHINE_NAME"); named && *named) return named;
#ifdef _WIN32
    // The WIDE name, as UTF-8: `gethostname` answers in the ANSI code page, and a name like
    // "PC-FRÉDÉRIC" in cp1252 is not UTF-8 — which JSON refuses (docs/supervisor.md).
    wchar_t wbuf[256] = {0};
    DWORD n = static_cast<DWORD>(std::size(wbuf));
    if (GetComputerNameExW(ComputerNameDnsHostname, wbuf, &n) && n > 0) return narrow(wbuf);
#endif
    char buf[256] = {0};
    if (gethostname(buf, sizeof buf - 1) != 0) return "localhost";
    return buf;
}

std::string sha256Hex(const std::string& s)
{
    unsigned char out[32];
    mbedtls_sha256(reinterpret_cast<const unsigned char*>(s.data()), s.size(), out, 0);
    static const char* digits = "0123456789abcdef";
    std::string h;
    for (unsigned char c : out) {
        h.push_back(digits[c >> 4]);
        h.push_back(digits[c & 15]);
    }
    return h;
}

}  // namespace

bool phantomInterface(const std::string& name)
{
    static const std::regex re(
        "^(vEthernet|WSL|Hyper-V|VirtualBox|VMware|vmnet|docker|br-|veth|tun|tap|utun|ZeroTier|Tailscale|wg\\d)",
        std::regex::icase);
    return std::regex_search(name, re);
}

nlohmann::json presence(int port)
{
    const std::string host = hostName();
    const auto ifaces = interfaces();
    std::vector<std::string> lan;
    std::set<std::string> macs;
    for (const auto& f : ifaces) {
        if (f.addressed && !f.internal && !f.mac.empty() && f.mac != "00:00:00:00:00:00") macs.insert(f.mac);
        if (f.internal || phantomInterface(f.name)) continue;
        for (const auto& ip : f.ipv4) {
            // Link-local is unroutable, and loopback is advertised on its own.
            if (ip.rfind("169.254.", 0) == 0 || ip.rfind("127.", 0) == 0 || ip == "0.0.0.0") continue;
            lan.push_back(ip);
        }
    }
    std::string seed = host + "|";
    bool first = true;
    for (const auto& m : macs) {
        if (!first) seed += ",";
        seed += m;
        first = false;
    }
    return {
        {"hostname", host},
        {"machineFingerprint", sha256Hex(seed)},
        {"port", port},
        {"addresses", {{"loopback", "127.0.0.1"}, {"lanIps", lan}, {"port", port}}},
    };
}

}  // namespace st0::addresses
