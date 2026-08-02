// See Warnings.h.

#include "Warnings.h"

#include <iostream>

namespace lanes {

namespace {
std::function<void(const Warning&)> g_sink;
}

void setWarningSink(std::function<void(const Warning&)> sink) {
    g_sink = std::move(sink);
}

void warn(std::string message, std::string subject) {
    // stderr first, and unconditionally: the sink can throw, be absent, or belong to a
    // client that has gone away, and none of that should cost the log its line.
    std::cerr << "warning: " << message;
    if (!subject.empty())
        std::cerr << " (for '" << subject << "')";
    std::cerr << std::endl;

    if (g_sink)
        g_sink(Warning{std::move(subject), std::move(message)});
}

}  // namespace lanes
