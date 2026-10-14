// NamModel.cpp — a .nam behind AmpModel, and the loader that tells a .nam from an RTNeural JSON.
// The one thing a reader would get wrong: NAM's Reset() PREWARMS, so it is the costly call, not process().

#include "AmpModel.h"

#include <NAM/get_dsp.h>

#include <algorithm>
#include <exception>
#include <filesystem>
#include <fstream>
#include <sstream>

namespace studio {

namespace {

class NamModel final : public AmpModel {
public:
    explicit NamModel(std::unique_ptr<nam::DSP> dsp) : dsp_(std::move(dsp))
    {
        // Read once: GetLoudness() throws when the model declares none, so only behind HasLoudness().
        if (dsp_->HasLoudness()) loudness_ = dsp_->GetLoudness();
    }

    void process(float* io, int n) override { dsp_->process(&io, &io, n); }

    void reset(double sampleRate, int maxBlock) override { dsp_->Reset(sampleRate, maxBlock); }

    // NAM_UNKNOWN_EXPECTED_SAMPLE_RATE (-1) means the model doesn't say — 0 is "nothing to check".
    double sampleRate() const override { return std::max(0.0, dsp_->GetExpectedSampleRate()); }

    std::optional<double> loudness() const override { return loudness_; }

    std::string describe() const override { return "nam"; }

private:
    std::unique_ptr<nam::DSP> dsp_;
    std::optional<double> loudness_;
};

std::string lower(std::string s)
{
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return (char)std::tolower(c); });
    return s;
}

}  // namespace

std::unique_ptr<AmpModel> loadNamModel(const std::string& path, std::string& error)
{
    std::unique_ptr<nam::DSP> dsp;
    try {
        dsp = nam::get_dsp(std::filesystem::path(path));
    } catch (const std::exception& e) {
        error = std::string("could not load model: ") + e.what();
        return nullptr;
    }
    if (dsp == nullptr) {
        error = "could not load model (no error given)";
        return nullptr;
    }
    return std::make_unique<NamModel>(std::move(dsp));
}

std::unique_ptr<AmpModel> loadAmpModel(const std::string& path, std::string& error)
{
    const auto ext = lower(std::filesystem::path(path).extension().string());
    if (ext == ".nam") return loadNamModel(path, error);
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        error = "could not read " + path;
        return nullptr;
    }
    std::stringstream text;
    text << in.rdbuf();
    return loadRtNeuralModel(text.str(), error);
}

}  // namespace studio
