// SessionRegistry: the invariants the engine's session map is relied on for.
//
// The concurrency case here is a STRESS TEST, not a race detector — MSVC ships no TSan, so on
// Windows it only proves "did not crash or tear under load". The real proof is CMakePresets'
// `asan` preset on a platform that has the sanitisers. See ../docs/sessions.md.

#include "SessionRegistry.h"
#include "test_harness.h"

#include <atomic>
#include <string>
#include <thread>
#include <vector>

using studio::SessionRegistry;

namespace {

// A stand-in for Session: the registry is a template precisely so this test needs no JUCE.
struct Payload {
    int sentinel = 0;
};

// Asking about a session must never conjure it — the invariant that stopped the supervisor's
// plugin poll from creating a phantom "" session in the tray's Sessions menu.
void find_does_not_create() {
    SessionRegistry<Payload> reg;
    CHECK(reg.find("st0") == nullptr);
    CHECK(reg.size() == 0);
    CHECK(reg.ids().empty());

    // …and neither does a withSession that matches nothing: it runs the lambda zero times.
    int ran = 0;
    CHECK(reg.withSession("st0", [&](Payload&) { ++ran; }) == false);
    CHECK(ran == 0);
    CHECK(reg.size() == 0);
}

void emplace_creates_once() {
    SessionRegistry<Payload> reg;
    bool created = false;
    Payload& a = reg.emplace("st0", &created);
    CHECK(created);
    a.sentinel = 42;
    Payload& b = reg.emplace("st0", &created);
    CHECK(!created);   // what tells EngineHost whether to stamp lastTouchedMs
    CHECK(&a == &b);
    CHECK(b.sentinel == 42);
    CHECK(reg.size() == 1);
    CHECK(reg.find("st0") == &a);
}

// The unique_ptr promise: a reference handed out stays valid however much the map grows around
// it. This is why a Session may hold a ring the audio thread writes into.
void reference_survives_growth() {
    SessionRegistry<Payload> reg;
    Payload& first = reg.emplace("first");
    first.sentinel = 7;
    for (int i = 0; i < 1000; ++i) reg.emplace("s" + std::to_string(i));
    CHECK(first.sentinel == 7);
    CHECK(&first == reg.find("first"));
    CHECK(reg.size() == 1001);
}

void erase_forgets() {
    SessionRegistry<Payload> reg;
    reg.emplace("st0");
    reg.emplace("m9");
    reg.erase("st0");
    CHECK(reg.find("st0") == nullptr);
    CHECK(reg.find("m9") != nullptr);
    CHECK(reg.ids() == std::vector<std::string>{"m9"});

    int ran = 0;
    CHECK(reg.withSession("st0", [&](Payload&) { ++ran; }) == false);
    CHECK(ran == 0);
}

void ids_are_sorted_and_copied() {
    SessionRegistry<Payload> reg;
    reg.emplace("m9");
    reg.emplace("st0");
    reg.emplace("pl8");
    // std::map ordering, and a COPY — the caller walks it without holding the lock.
    CHECK((reg.ids() == std::vector<std::string>{"m9", "pl8", "st0"}));
}

// One writer growing the map while two readers work it, which is the shape of the real fault:
// the sender thread drains a ring through withSession while the message thread emplaces.
void concurrent_readers_never_tear() {
    SessionRegistry<Payload> reg;
    reg.emplace("live").sentinel = 99;

    std::atomic<bool> stop{false};
    std::atomic<int> torn{0};
    std::atomic<int> conjured{0};

    std::thread writer([&] {
        for (int i = 0; i < 5000; ++i) reg.emplace("s" + std::to_string(i));
        stop = true;
    });
    std::thread reader([&] {
        while (!stop)
            reg.withSession("live", [&](Payload& p) {
                if (p.sentinel != 99) ++torn;
            });
    });
    std::thread misser([&] {
        while (!stop)
            if (reg.find("nobody") != nullptr) ++conjured;
    });

    writer.join();
    reader.join();
    misser.join();

    CHECK(torn == 0);
    CHECK(conjured == 0);
    CHECK(reg.find("live") != nullptr);
    CHECK(reg.find("nobody") == nullptr);   // reading about it 1000s of times still did not make it
}

}  // namespace

int main() {
    RUN(find_does_not_create);
    RUN(emplace_creates_once);
    RUN(reference_survives_growth);
    RUN(erase_forgets);
    RUN(ids_are_sorted_and_copied);
    RUN(concurrent_readers_never_tear);
    TEST_MAIN_END();
}
