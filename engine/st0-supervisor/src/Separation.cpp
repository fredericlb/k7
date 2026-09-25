// Separation.cpp — see Separation.h.

#include "Separation.h"

namespace st0::separation {

void run(const Request& r, const std::function<void(const nlohmann::json& job)>& report)
{
    report({{"id", ""},
            {"source", r.source},
            {"done", true},
            {"failed", true},
            {"error", "stem separation is not built into this supervisor yet"},
            {"phase", "failed"},
            {"percent", nullptr},
            {"lines", nlohmann::json::array()},
            {"files", nlohmann::json::array()}});
}

}  // namespace st0::separation
