// The pairing store, JUCE-free like the other fast binaries: who counts as the machine itself, a request
// approved or denied, a key that verifies and one that does not, and a pairing that survives a restart.
// What would go wrong SILENTLY: a revoked device still driving, or the LAN read as loopback. docs/pairing.md.

#include "Pairing.h"

#include "test_harness.h"

#include <cstdio>
#include <filesystem>
#include <string>

using studio::isLoopbackAddress;
using studio::Pairing;

namespace {

// Any distinct address stands for a socket: the store keys on pointers it never dereferences.
const auto* phone = reinterpret_cast<const ix::WebSocket*>(0x10);
const auto* laptop = reinterpret_cast<const ix::WebSocket*>(0x20);

std::string tempStore() {
    const auto p = std::filesystem::temp_directory_path() / "studio-pairing-test.json";
    std::filesystem::remove(p);
    return p.string();
}

void loopback_is_the_machine_and_nothing_else() {
    CHECK(isLoopbackAddress("127.0.0.1"));
    CHECK(isLoopbackAddress("127.4.5.6"));
    CHECK(isLoopbackAddress("::1"));
    CHECK(isLoopbackAddress("::ffff:127.0.0.1"));
    CHECK(!isLoopbackAddress("192.168.1.20"));
    CHECK(!isLoopbackAddress("10.0.0.1"));
    CHECK(!isLoopbackAddress("::ffff:192.168.1.20"));
    CHECK(!isLoopbackAddress("fe80::1"));
    CHECK(!isLoopbackAddress(""));
}

// A page the user merely visits must not drive the engine: only the studio's own origins, and native clients.
void only_the_studio_origins_open_a_socket() {
    const std::vector<std::string> none;
    for (const char* ok : {"http://127.0.0.1:18789", "http://localhost:5173", "http://[::1]:8080", "https://localhost",
                           "https://st0.app", "https://priv.st0.app", "HTTPS://ST0.APP/", "ws://127.0.0.1:8765",
                           "wss://192.168.1.5:8765"})
        CHECK(studio::originAllowed(ok, none));
    for (const char* bad : {"https://evil.example", "https://st0.app.evil.example", "https://evilst0.app",
                            "http://st0.app", "https://st0.app:8443", "https://user@st0.app", "null", "",
                            "file://", "http://127.0.0.1.evil.example", "http://localhost:abc", "http://[::1]x"})
        CHECK(!studio::originAllowed(bad, none));
    const auto extra = studio::parseOrigins(" https://studio.example.org/ ,http://studio.lan:8080,, ");
    CHECK(extra.size() == 2);
    CHECK(studio::originAllowed("https://studio.example.org", extra));
    CHECK(studio::originAllowed("http://studio.lan:8080", extra));
    CHECK(!studio::originAllowed("http://studio.lan:8081", extra));
}

void an_approved_request_yields_a_key_that_verifies() {
    Pairing p(tempStore());
    const auto r = p.request("iPhone · Safari", "192.168.1.20", phone);
    CHECK(r.has_value());
    CHECK(r->code.size() == 6);
    CHECK(p.pending().size() == 1);
    const auto a = p.approve(r->id);
    CHECK(a.has_value());
    CHECK(a->from == phone);
    CHECK(a->key.size() == 64);
    CHECK(p.pending().empty());
    CHECK(p.verify(a->key, laptop).has_value());
    CHECK(!p.verify(std::string(64, '0'), laptop).has_value());
    CHECK(!p.verify("", laptop).has_value());
    CHECK(!p.approve(r->id).has_value());   // answered once
}

void a_denied_request_is_gone() {
    Pairing p(tempStore());
    const auto r = p.request("tablet", "192.168.1.21", phone);
    CHECK(p.deny(r->id) == phone);
    CHECK(p.pending().empty());
    CHECK(!p.approve(r->id).has_value());
}

void asking_again_replaces_the_request() {
    Pairing p(tempStore());
    const auto first = p.request("phone", "192.168.1.20", phone);
    const auto second = p.request("phone", "192.168.1.20", phone);
    CHECK(p.pending().size() == 1);
    CHECK(!p.approve(first->id).has_value());
    CHECK(p.approve(second->id).has_value());
}

void the_room_cannot_queue_without_bound() {
    Pairing p(tempStore());
    for (int i = 0; i < 8; ++i)
        CHECK(p.request("d", "192.168.1.30", reinterpret_cast<const ix::WebSocket*>(0x100 + i)).has_value());
    CHECK(!p.request("one too many", "192.168.1.31", laptop).has_value());
}

void a_closed_socket_takes_its_request_with_it() {
    Pairing p(tempStore());
    p.request("phone", "192.168.1.20", phone);
    CHECK(p.forget(phone));
    CHECK(p.pending().empty());
    CHECK(!p.forget(phone));
}

void a_pairing_survives_a_restart_and_a_revoke_ends_it() {
    const auto file = tempStore();
    std::string key, id;
    {
        Pairing p(file);
        const auto a = p.approve(p.request("phone", "192.168.1.20", phone)->id);
        key = a->key;
        id = a->device.id;
    }
    Pairing again(file);
    CHECK(again.devices().size() == 1);
    CHECK(again.verify(key, laptop).has_value());
    const auto live = again.revoke(id);
    CHECK(live.size() == 1 && live[0] == laptop);   // its open connection, to be closed
    CHECK(!again.verify(key, phone).has_value());
    Pairing reread(file);
    CHECK(reread.devices().empty());
}

void an_unreadable_store_pairs_nobody() {
    const auto file = tempStore();
    if (FILE* f = std::fopen(file.c_str(), "w")) {
        std::fputs("{ not json", f);
        std::fclose(f);
    }
    Pairing p(file);
    CHECK(p.devices().empty());
}

}  // namespace

int main() {
    RUN(loopback_is_the_machine_and_nothing_else);
    RUN(only_the_studio_origins_open_a_socket);
    RUN(an_approved_request_yields_a_key_that_verifies);
    RUN(a_denied_request_is_gone);
    RUN(asking_again_replaces_the_request);
    RUN(the_room_cannot_queue_without_bound);
    RUN(a_closed_socket_takes_its_request_with_it);
    RUN(a_pairing_survives_a_restart_and_a_revoke_ends_it);
    RUN(an_unreadable_store_pairs_nobody);
    TEST_MAIN_END();
}
