// The RTNeural half of AmpModel: AIDA-X and Proteus files load into the right net, and that net computes what the
// cell equations say. The expected outputs come from data/ampmodel/gen_fixtures.py, written from PyTorch's and
// Keras's equations rather than from RTNeural, so a wrong weight layout fails here. JUCE-free, a fast binary.

#include "AmpModel.h"
#include "test_harness.h"

#include <nlohmann/json.hpp>

#include <cmath>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

using namespace studio;

namespace {

std::string slurp(const std::string& name)
{
    std::ifstream in(std::string(STUDIO_AMPMODEL_FIXTURES) + "/" + name, std::ios::binary);
    std::stringstream s;
    s << in.rdbuf();
    return s.str();
}

// Load `name`, set its knobs, reset at its own rate, run the fixture's signal and compare to the reference.
float worstError(const char* name, std::string* described = nullptr, int* knobs = nullptr)
{
    std::string error;
    auto model = loadRtNeuralModel(slurp(std::string(name) + ".json"), error);
    CHECK(model != nullptr);
    if (model == nullptr) {
        std::printf("    %s: %s\n", name, error.c_str());
        return 1e9f;
    }
    const auto expect = nlohmann::json::parse(slurp(std::string(name) + ".expect.json"));
    std::vector<float> k(AmpModel::MAX_KNOBS, 0.5f);
    const auto given = expect.at("knobs").get<std::vector<float>>();
    for (size_t i = 0; i < given.size(); ++i) k[i] = given[i];
    model->setKnobs(k.data());
    model->reset(model->sampleRate(), 64);
    auto x = expect.at("x").get<std::vector<float>>();
    const auto y = expect.at("y").get<std::vector<float>>();
    // In blocks, as the plugin calls it.
    for (size_t at = 0; at < x.size(); at += 64) model->process(x.data() + at, (int)std::min<size_t>(64, x.size() - at));
    float worst = 0.0f;
    for (size_t i = 0; i < y.size(); ++i) worst = std::fmax(worst, std::fabs(x[i] - y[i]));
    if (described) *described = model->describe();
    if (knobs) *knobs = model->knobs();
    return worst;
}

void a_proteus_lstm_with_one_knob_matches_pytorch()
{
    std::string what;
    int knobs = -1;
    CHECK(worstError("proteus_lstm_8x2", &what, &knobs) < 1e-4f);
    CHECK(what == "proteus lstm 8x2");
    CHECK(knobs == 1);
}

void a_proteus_gru_matches_pytorch() { CHECK(worstError("proteus_gru_8x1") < 1e-4f); }

void a_shape_not_compiled_in_runs_on_the_generic_net()
{
    std::string what;
    CHECK(worstError("proteus_lstm_10x1", &what) < 1e-4f);
    CHECK(what == "proteus lstm 10x1 (generic)");
    CHECK(worstError("aidax_lstm_10x3", &what) < 1e-4f);
    CHECK(what == "aida-x lstm 10x3 (generic)");
}

void an_aidax_model_applies_its_skip_and_its_gains()
{
    CHECK(worstError("aidax_lstm_8x2_skip") < 1e-4f);
    CHECK(worstError("aidax_lstm_12x1") < 1e-4f);
}

void the_rate_is_the_one_the_file_declares_else_the_format_default()
{
    std::string error;
    CHECK(loadRtNeuralModel(slurp("aidax_lstm_12x1.json"), error)->sampleRate() == 48000.0);
    CHECK(loadRtNeuralModel(slurp("proteus_lstm_10x1.json"), error)->sampleRate() == 48000.0);
    CHECK(loadRtNeuralModel(slurp("proteus_gru_8x1.json"), error)->sampleRate() == 44100.0);
}

void moving_a_knob_moves_the_sound()
{
    std::string error;
    const auto text = slurp("proteus_lstm_8x2.json");
    const auto render = [&](float knob) {
        auto m = loadRtNeuralModel(text, error);
        const float k[AmpModel::MAX_KNOBS] = {knob, 0.5f, 0.5f};
        m->setKnobs(k);
        m->reset(44100.0, 256);
        std::vector<float> x(256);
        for (int i = 0; i < 256; ++i) x[(size_t)i] = 0.5f * std::sin(0.08f * (float)i);
        m->process(x.data(), 256);
        return x;
    };
    const auto a = render(0.0f);
    const auto b = render(1.0f);
    float diff = 0.0f;
    for (size_t i = 0; i < a.size(); ++i) diff = std::fmax(diff, std::fabs(a[i] - b[i]));
    CHECK(diff > 1e-3f);
}

void a_file_that_is_no_model_is_refused_with_a_reason()
{
    std::string error;
    CHECK(loadRtNeuralModel("{ \"hello\": 1 }", error) == nullptr);
    CHECK(error.find("neither") != std::string::npos);
    error.clear();
    CHECK(loadRtNeuralModel("not json", error) == nullptr);
    CHECK(!error.empty());
    error.clear();
    // Declares a shape its weights do not have: refused, not a crash.
    CHECK(loadRtNeuralModel(R"({"model_data":{"hidden_size":8,"input_size":1},"state_dict":{}})", error) == nullptr);
    CHECK(!error.empty());
}

}  // namespace

int main()
{
    RUN(a_proteus_lstm_with_one_knob_matches_pytorch);
    RUN(a_proteus_gru_matches_pytorch);
    RUN(a_shape_not_compiled_in_runs_on_the_generic_net);
    RUN(an_aidax_model_applies_its_skip_and_its_gains);
    RUN(the_rate_is_the_one_the_file_declares_else_the_format_default);
    RUN(moving_a_knob_moves_the_sound);
    RUN(a_file_that_is_no_model_is_refused_with_a_reason);
    TEST_MAIN_END();
}
