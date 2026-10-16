// Supersede: which queued jobs a newer message skips, and which it must leave alone.
// The queue here is a plain vector standing in for the message thread; see ../docs/supersede.md.

#include "Supersede.h"
#include "test_harness.h"

#include <functional>
#include <string>
#include <vector>

using studio::SupersedeLedger;

namespace {

// The message queue, in posting order, and what ran when it was drained.
struct Queue {
    std::vector<std::function<void()>> jobs;
    std::vector<std::string> ran;

    void project(SupersedeLedger& l, const std::string& s, const std::string& tag) {
        l.postProject(s, [&](SupersedeLedger::Ticket t) { push(t, tag); });
    }
    void tracks(SupersedeLedger& l, const std::string& s, std::vector<std::string> ids, const std::string& tag) {
        l.postTracks(s, std::move(ids), [&](SupersedeLedger::Ticket t) { push(t, tag); });
    }
    void param(SupersedeLedger& l, const std::string& s, const std::string& id, const std::string& name,
               const std::string& tag) {
        l.postParam(s, id, name, [&](SupersedeLedger::Ticket t) { push(t, tag); });
    }
    // A verb that is never superseded: the dispatcher fences, then the handler posts.
    void other(SupersedeLedger& l, const std::string& s, const std::string& tag) {
        l.barrier(s);
        jobs.push_back([this, tag] { ran.push_back(tag); });
    }
    void drain() {
        for (auto& j : jobs) j();
        jobs.clear();
    }

private:
    void push(SupersedeLedger::Ticket t, const std::string& tag) {
        jobs.push_back([this, t, tag] {
            if (!SupersedeLedger::superseded(t)) ran.push_back(tag);
        });
    }
};

void latest_project_wins() {
    SupersedeLedger l;
    Queue q;
    q.project(l, "k7", "p1");
    q.project(l, "k7", "p2");
    q.project(l, "k7", "p3");
    q.drain();
    CHECK((q.ran == std::vector<std::string>{"p3"}));
}

// The ordering this must never break: a transport between two documents runs after the first.
void another_verb_fences() {
    SupersedeLedger l;
    Queue q;
    q.project(l, "k7", "p1");
    q.other(l, "k7", "play");
    q.project(l, "k7", "p2");
    q.drain();
    CHECK((q.ran == std::vector<std::string>{"p1", "play", "p2"}));
}

void sessions_are_apart() {
    SupersedeLedger l;
    Queue q;
    q.project(l, "a", "a1");
    q.project(l, "b", "b1");
    q.other(l, "b", "b-play");
    q.project(l, "a", "a2");
    q.drain();
    CHECK((q.ran == std::vector<std::string>{"b1", "b-play", "a2"}));
}

// A project replaces the whole document, so a delta queued before it is pointless; one after it is not.
void project_swallows_earlier_tracks() {
    SupersedeLedger l;
    Queue q;
    q.tracks(l, "k7", {"drums"}, "t1");
    q.project(l, "k7", "p1");
    q.tracks(l, "k7", {"drums"}, "t2");
    q.drain();
    CHECK((q.ran == std::vector<std::string>{"p1", "t2"}));
}

// A delta replaces only the tracks it names: it overtakes a delta naming the same set, never another one.
void tracks_by_set() {
    SupersedeLedger l;
    Queue q;
    q.tracks(l, "k7", {"bass", "drums"}, "t1");
    q.tracks(l, "k7", {"keys"}, "t2");
    q.tracks(l, "k7", {"drums", "bass", "drums"}, "t3");
    q.drain();
    CHECK((q.ran == std::vector<std::string>{"t2", "t3"}));
}

// A delta never overtakes a project: the project's other tracks would be lost.
void tracks_never_swallow_a_project() {
    SupersedeLedger l;
    Queue q;
    q.project(l, "k7", "p1");
    q.tracks(l, "k7", {"drums"}, "t1");
    q.drain();
    CHECK((q.ran == std::vector<std::string>{"p1", "t1"}));
}

void param_by_plugin_and_name() {
    SupersedeLedger l;
    Queue q;
    q.param(l, "k7", "synth", "cutoff", "c1");
    q.param(l, "k7", "synth", "res", "r1");
    q.param(l, "k7", "delay", "cutoff", "d1");
    q.param(l, "k7", "synth", "cutoff", "c2");
    q.drain();
    CHECK((q.ran == std::vector<std::string>{"r1", "d1", "c2"}));
}

// Documents and live parameters coalesce across each other — the knob dragged during a slow apply.
void params_and_documents_interleave() {
    SupersedeLedger l;
    Queue q;
    q.project(l, "k7", "p1");
    q.param(l, "k7", "synth", "cutoff", "c1");
    q.project(l, "k7", "p2");
    q.param(l, "k7", "synth", "cutoff", "c2");
    q.drain();
    CHECK((q.ran == std::vector<std::string>{"p2", "c2"}));
}

void barrier_fences_params_too() {
    SupersedeLedger l;
    Queue q;
    q.param(l, "k7", "synth", "cutoff", "c1");
    q.other(l, "k7", "set-preset");
    q.param(l, "k7", "synth", "cutoff", "c2");
    q.drain();
    CHECK((q.ran == std::vector<std::string>{"c1", "set-preset", "c2"}));
}

// A job that already ran is not undone by a later mark, and a fence leaves nothing behind.
void ran_jobs_stay_run_and_fences_clean_up() {
    SupersedeLedger l;
    Queue q;
    q.project(l, "k7", "p1");
    q.drain();
    q.project(l, "k7", "p2");
    q.drain();
    CHECK((q.ran == std::vector<std::string>{"p1", "p2"}));
    CHECK(l.sessionCount() == 1);
    l.barrier("k7");
    CHECK(l.sessionCount() == 0);
}

}  // namespace

int main() {
    RUN(latest_project_wins);
    RUN(another_verb_fences);
    RUN(sessions_are_apart);
    RUN(project_swallows_earlier_tracks);
    RUN(tracks_by_set);
    RUN(tracks_never_swallow_a_project);
    RUN(param_by_plugin_and_name);
    RUN(params_and_documents_interleave);
    RUN(barrier_fences_params_too);
    RUN(ran_jobs_stay_run_and_fences_clean_up);
    TEST_MAIN_END();
}
