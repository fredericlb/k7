// RtNeuralModel.cpp — an RTNeural recurrent amp model behind AmpModel: AIDA-X's Keras JSON or Proteus's PyTorch JSON.
// One RNN layer and a dense output run as a compiled-shape ModelT (about twice as fast); anything else
// runs as RTNeural's generic Model. The one thing a reader would get wrong: the knob inputs follow the
// audio in ONE input vector — [sample, knob1, knob2, …] — so a model's knob count is its input size minus one.
// Formats and choices: docs/namPlugin.md.

#include "AmpModel.h"

// Ours first: RTNeural bundles nlohmann 3.11.1 behind the same include guard, which then stands aside.
#include <nlohmann/json.hpp>

#include <RTNeural/RTNeural.h>

#include <array>
#include <cmath>
#include <exception>
#include <type_traits>
#include <utility>

namespace studio {

namespace {

using json = nlohmann::json;

// The shapes compiled in, per cell and per input count — AIDA-X's trainer offers these hidden sizes.
using Hiddens = std::integer_sequence<int, 8, 12, 16, 20, 24, 32, 40, 64>;

// Silence run through a freshly reset net, so its bias-driven state has settled before it is heard.
constexpr int PREWARM_SAMPLES = 4096;

// How fast a knob glides to where it is set: 10 ms, slow enough not to zipper a recurrent net.
constexpr double KNOB_GLIDE_S = 0.01;

struct Net {
    virtual ~Net() = default;
    virtual void reset() = 0;
    virtual float forward(const float* in) = 0;
};

template <class M>
struct FixedNet final : Net {
    M model;
    void reset() override { model.reset(); }
    float forward(const float* in) override { return model.forward(in); }
};

struct DynamicNet final : Net {
    std::unique_ptr<RTNeural::Model<float>> model;
    void reset() override { model->reset(); }
    float forward(const float* in) override { return model->forward(in); }
};

template <int I, int H>
using LstmModel = RTNeural::ModelT<float, I, 1, RTNeural::LSTMLayerT<float, I, H>, RTNeural::DenseT<float, H, 1>>;
template <int I, int H>
using GruModel = RTNeural::ModelT<float, I, 1, RTNeural::GRULayerT<float, I, H>, RTNeural::DenseT<float, H, 1>>;

struct Shape {
    bool lstm = true;
    int inputs = 1;
    int hidden = 0;
};

// A compiled net for `s`, filled by `fill(model)`, or nullptr when that shape is not compiled in.
template <class Fill>
std::unique_ptr<Net> fixedNet(const Shape& s, Fill&& fill)
{
    std::unique_ptr<Net> out;
    const auto one = [&](auto lstm, auto inputs, auto hidden) {
        constexpr bool L = decltype(lstm)::value;
        constexpr int I = decltype(inputs)::value;
        constexpr int H = decltype(hidden)::value;
        if (out || s.lstm != L || s.inputs != I || s.hidden != H) return;
        using M = std::conditional_t<L, LstmModel<I, H>, GruModel<I, H>>;
        auto net = std::make_unique<FixedNet<M>>();
        fill(net->model);
        out = std::move(net);
    };
    const auto sizes = [&](auto lstm, auto inputs) {
        [&]<int... H>(std::integer_sequence<int, H...>) {
            (one(lstm, inputs, std::integral_constant<int, H>{}), ...);
        }(Hiddens{});
    };
    const auto inputs = [&](auto lstm) {
        sizes(lstm, std::integral_constant<int, 1>{});
        sizes(lstm, std::integral_constant<int, 2>{});
        sizes(lstm, std::integral_constant<int, 3>{});
        sizes(lstm, std::integral_constant<int, 4>{});
    };
    inputs(std::true_type{});
    inputs(std::false_type{});
    return out;
}

// A compiled shape's recurrent layer is an LSTM — the other one being a GRU.
template <class R>
constexpr bool isLstm = std::is_same_v<R, RTNeural::LSTMLayerT<float, R::in_size, R::out_size>>;

double number(const json& j, const char* key, double fallback)
{
    if (!j.is_object() || !j.contains(key)) return fallback;
    const auto& v = j.at(key);
    if (v.is_number()) return v.get<double>();
    // AIDA-X writes its metadata's samplerate as a STRING.
    if (v.is_string()) {
        try {
            return std::stod(v.get<std::string>());
        } catch (...) {
            return fallback;
        }
    }
    return fallback;
}

class RtNeuralModel final : public AmpModel {
public:
    RtNeuralModel(std::unique_ptr<Net> net, int knobs, bool skip, float inGainDb, float outGainDb, double rate,
                  std::string what)
        : net_(std::move(net)), knobs_(knobs), skip_(skip),
          inGain_(std::pow(10.0f, inGainDb / 20.0f)), outGain_(std::pow(10.0f, outGainDb / 20.0f)), rate_(rate),
          what_(std::move(what))
    {
        target_.fill(0.5f);
        knob_.fill(0.5f);
    }

    void process(float* io, int n) override
    {
        alignas(RTNEURAL_DEFAULT_ALIGNMENT) float x[1 + MAX_KNOBS] = {};
        for (int i = 0; i < n; ++i) {
            for (int k = 0; k < knobs_; ++k) {
                knob_[(size_t)k] += (target_[(size_t)k] - knob_[(size_t)k]) * glide_;
                x[1 + k] = knob_[(size_t)k];
            }
            const float in = io[i] * inGain_;
            x[0] = in;
            const float y = net_->forward(x);
            // With a skip the net learned only the DIFFERENCE, and AIDA-X applies no output gain to that sum.
            io[i] = skip_ ? y + in : y * outGain_;
        }
    }

    void reset(double sampleRate, int /*maxBlock*/) override
    {
        glide_ = sampleRate > 0.0 ? (float)(1.0 - std::exp(-1.0 / (KNOB_GLIDE_S * sampleRate))) : 1.0f;
        knob_ = target_;
        net_->reset();
        alignas(RTNEURAL_DEFAULT_ALIGNMENT) float x[1 + MAX_KNOBS] = {};
        for (int k = 0; k < knobs_; ++k) x[1 + k] = knob_[(size_t)k];
        for (int i = 0; i < PREWARM_SAMPLES; ++i) net_->forward(x);
    }

    double sampleRate() const override { return rate_; }
    int knobs() const override { return knobs_; }

    void setKnobs(const float* values) override
    {
        for (int k = 0; k < knobs_; ++k)
            target_[(size_t)k] = std::isfinite(values[k]) ? std::fmin(1.0f, std::fmax(0.0f, values[k])) : 0.5f;
    }

    std::string describe() const override { return what_; }

private:
    std::unique_ptr<Net> net_;
    int knobs_;
    bool skip_;
    float inGain_, outGain_;
    double rate_;
    std::string what_;
    float glide_ = 1.0f;
    std::array<float, MAX_KNOBS> target_{}, knob_{};
};

std::string shapeName(const Shape& s)
{
    return std::string(s.lstm ? "lstm " : "gru ") + std::to_string(s.hidden) + "x" + std::to_string(s.inputs);
}

// AIDA-X: RTNeural's own Keras export, plus in_skip, in_gain, out_gain and a metadata block.
std::unique_ptr<AmpModel> loadKeras(const json& j, std::string& error)
{
    const int inputs = j.at("in_shape").back().get<int>();
    if (inputs < 1 || inputs > 1 + AmpModel::MAX_KNOBS) {
        error = "model takes " + std::to_string(inputs) + " inputs; at most " +
                std::to_string(1 + AmpModel::MAX_KNOBS) + " (the sound and its knobs) are supported";
        return nullptr;
    }
    const auto& layers = j.at("layers");
    Shape s{true, inputs, 0};
    std::unique_ptr<Net> net;
    if (layers.size() == 2 && layers[1].at("type") == "dense" && layers[1].at("shape").back() == 1) {
        const auto type = layers[0].at("type").get<std::string>();
        if (type == "lstm" || type == "gru") {
            s.lstm = type == "lstm";
            s.hidden = layers[0].at("shape").back().get<int>();
            net = fixedNet(s, [&](auto& model) { model.parseJson(j); });
        }
    }
    std::string what = "aida-x " + (s.hidden ? shapeName(s) : std::string("generic"));
    if (net == nullptr) {
        auto dyn = std::make_unique<DynamicNet>();
        dyn->model = RTNeural::json_parser::parseJson<float>(j);
        if (dyn->model == nullptr || dyn->model->getInSize() != inputs || dyn->model->getOutSize() != 1) {
            error = "model is not one sound in and one sound out";
            return nullptr;
        }
        net = std::move(dyn);
        if (s.hidden) what += " (generic)";
    }
    const bool skip = number(j, "in_skip", 0.0) != 0.0;
    const double rate = number(j.value("metadata", json::object()), "samplerate", 48000.0);
    return std::make_unique<RtNeuralModel>(std::move(net), inputs - 1, skip, (float)number(j, "in_gain", 0.0),
                                           (float)number(j, "out_gain", 0.0), rate, what);
}

// Proteus (GuitarML's Automated-GuitarAmpModelling): a PyTorch state_dict of `rec.` (the RNN) and `lin.`.
std::unique_ptr<AmpModel> loadTorch(const json& j, std::string& error)
{
    const auto& md = j.at("model_data");
    const auto& sd = j.at("state_dict");
    Shape s;
    const auto unit = md.value("unit_type", std::string("LSTM"));
    s.lstm = unit != "GRU";
    s.inputs = (int)number(md, "input_size", 1.0);
    s.hidden = (int)number(md, "hidden_size", 0.0);
    if ((int)number(md, "num_layers", 1.0) != 1 || (int)number(md, "output_size", 1.0) != 1 || s.hidden <= 0) {
        error = "only one-layer, one-output Proteus models are supported";
        return nullptr;
    }
    if (s.inputs < 1 || s.inputs > 1 + AmpModel::MAX_KNOBS) {
        error = "model takes " + std::to_string(s.inputs) + " inputs; at most " +
                std::to_string(1 + AmpModel::MAX_KNOBS) + " are supported";
        return nullptr;
    }
    const auto fill = [&](auto& model) {
        auto& rnn = model.template get<0>();
        if constexpr (isLstm<std::decay_t<decltype(rnn)>>)
            RTNeural::torch_helpers::loadLSTM<float>(sd, "rec.", rnn);
        else
            RTNeural::torch_helpers::loadGRU<float>(sd, "rec.", rnn);
        RTNeural::torch_helpers::loadDense<float>(sd, "lin.", model.template get<1>());
    };
    auto net = fixedNet(s, fill);
    std::string what = "proteus " + shapeName(s);
    if (net == nullptr) {
        auto dyn = std::make_unique<DynamicNet>();
        dyn->model = std::make_unique<RTNeural::Model<float>>(s.inputs);
        if (s.lstm) {
            auto* rnn = new RTNeural::LSTMLayer<float>(s.inputs, s.hidden);
            RTNeural::torch_helpers::loadLSTM<float>(sd, "rec.", *rnn);
            dyn->model->addLayer(rnn);
        } else {
            auto* rnn = new RTNeural::GRULayer<float>(s.inputs, s.hidden);
            RTNeural::torch_helpers::loadGRU<float>(sd, "rec.", *rnn);
            dyn->model->addLayer(rnn);
        }
        auto* dense = new RTNeural::Dense<float>(s.hidden, 1);
        RTNeural::torch_helpers::loadDense<float>(sd, "lin.", *dense);
        dyn->model->addLayer(dense);
        net = std::move(dyn);
        what += " (generic)";
    }
    // Proteus always adds the input back: its nets are trained on the difference.
    const bool skip = number(md, "skip", 1.0) != 0.0;
    const double rate = number(md, "sample_rate", number(md, "samplerate", 44100.0));
    return std::make_unique<RtNeuralModel>(std::move(net), s.inputs - 1, skip, 0.0f, 0.0f, rate, what);
}

}  // namespace

std::unique_ptr<AmpModel> loadRtNeuralModel(const std::string& text, std::string& error)
{
    try {
        const auto j = json::parse(text);
        if (j.contains("model_data") && j.contains("state_dict")) return loadTorch(j, error);
        if (j.contains("layers") && j.contains("in_shape")) return loadKeras(j, error);
        error = "not a model this engine reads: neither NAM, AIDA-X nor Proteus";
    } catch (const std::exception& e) {
        error = std::string("could not load model: ") + e.what();
    }
    return nullptr;
}

}  // namespace studio
