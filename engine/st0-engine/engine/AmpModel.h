// AmpModel.h — one neural amp model, whatever trained it: a .nam (NAM's WaveNet/LSTM) or an RTNeural
// recurrent net (AIDA-X's Keras JSON, Proteus's PyTorch JSON). JUCE-free, so tests/ runs the RTNeural half.
// The one thing a reader would get wrong: `process` runs at the MODEL's rate — NamPlugin resamples around it.
// docs/namPlugin.md.

#pragma once

#include <memory>
#include <optional>
#include <string>

namespace studio {

class AmpModel {
public:
    // How many knob inputs a model can be trained with, and so how many `Knob n` params the plugin carries.
    static constexpr int MAX_KNOBS = 3;

    virtual ~AmpModel() = default;

    // Mono, in place, `n` ≤ the block given to reset(). Audio thread.
    virtual void process(float* io, int n) = 0;

    // Clear the state for this rate and block, and prewarm. Allocates: never on the audio thread unlocked.
    virtual void reset(double sampleRate, int maxBlock) = 0;

    // The rate the model was trained at; 0 when it does not say and nothing can be assumed.
    virtual double sampleRate() const = 0;

    // The output loudness the model declares, in dB — only a .nam carries one.
    virtual std::optional<double> loudness() const { return std::nullopt; }

    // How many knob inputs it was trained with (0..MAX_KNOBS), read in order from setKnobs.
    virtual int knobs() const { return 0; }

    // Where the knobs are heading, 0..1 each; the model glides to them sample by sample. Audio thread.
    virtual void setKnobs(const float* /*values*/) {}

    // What loaded, for the log: "nam", "aida-x lstm 16x2", "proteus lstm 40x1"…
    virtual std::string describe() const = 0;
};

// A .nam file, through NeuralAmpModelerCore. Throws nothing: an error comes back in `error`.
std::unique_ptr<AmpModel> loadNamModel(const std::string& path, std::string& error);

// An RTNeural model from its JSON TEXT — AIDA-X or Proteus, told apart by their keys.
std::unique_ptr<AmpModel> loadRtNeuralModel(const std::string& json, std::string& error);

// Either, by what the file is: `.nam` is NAM's, any other JSON is tried as an RTNeural model.
std::unique_ptr<AmpModel> loadAmpModel(const std::string& path, std::string& error);

}  // namespace studio
