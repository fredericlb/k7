# gen_fixtures.py — tiny AIDA-X and Proteus models with random weights, and what they must output.
# The reference is written here from the cell equations (PyTorch's and Keras's), independently of RTNeural,
# so AmpModel_test.cpp checks the loading AND the arithmetic. Python stdlib only; rerun after a change:
#   python3 engine/st0-engine/tests/data/ampmodel/gen_fixtures.py
import json, math, os, random

HERE = os.path.dirname(os.path.abspath(__file__))
PREWARM = 4096  # RtNeuralModel's PREWARM_SAMPLES: zeros run before the signal, knobs held
N = 256

sig = lambda x: 1.0 / (1.0 + math.exp(-x))

def mat(rng, rows, cols, s=0.4):
    return [[rng.uniform(-s, s) for _ in range(cols)] for _ in range(rows)]

def vec(rng, n, s=0.2):
    return [rng.uniform(-s, s) for _ in range(n)]

def signal():
    return [0.6 * math.sin(2 * math.pi * 0.013 * n) + 0.25 * math.sin(2 * math.pi * 0.071 * n) for n in range(N)]

# PyTorch LSTM: rows of weight_ih are the gates i, f, g, o.
def torch_lstm(w_ih, w_hh, b_ih, b_hh, H):
    h = [0.0] * H; c = [0.0] * H
    def step(x):
        nonlocal h, c
        z = [sum(w_ih[r][k] * x[k] for k in range(len(x))) + sum(w_hh[r][k] * h[k] for k in range(H)) + b_ih[r] + b_hh[r]
             for r in range(4 * H)]
        i = [sig(v) for v in z[0:H]]; f = [sig(v) for v in z[H:2 * H]]
        g = [math.tanh(v) for v in z[2 * H:3 * H]]; o = [sig(v) for v in z[3 * H:4 * H]]
        c = [f[k] * c[k] + i[k] * g[k] for k in range(H)]
        h = [o[k] * math.tanh(c[k]) for k in range(H)]
        return h
    return step

# PyTorch GRU: rows are r, z, n; the hidden part of n is gated by r.
def torch_gru(w_ih, w_hh, b_ih, b_hh, H):
    h = [0.0] * H
    def step(x):
        nonlocal h
        gi = [sum(w_ih[r][k] * x[k] for k in range(len(x))) + b_ih[r] for r in range(3 * H)]
        gh = [sum(w_hh[r][k] * h[k] for k in range(H)) + b_hh[r] for r in range(3 * H)]
        r = [sig(gi[k] + gh[k]) for k in range(H)]
        z = [sig(gi[H + k] + gh[H + k]) for k in range(H)]
        n = [math.tanh(gi[2 * H + k] + r[k] * gh[2 * H + k]) for k in range(H)]
        h = [(1 - z[k]) * n[k] + z[k] * h[k] for k in range(H)]
        return h
    return step

# Keras LSTM: kernel is (in × 4H), recurrent (H × 4H), gates i, f, c, o.
def keras_lstm(W, U, b, H):
    h = [0.0] * H; c = [0.0] * H
    def step(x):
        nonlocal h, c
        z = [sum(x[k] * W[k][r] for k in range(len(x))) + sum(h[k] * U[k][r] for k in range(H)) + b[r] for r in range(4 * H)]
        i = [sig(v) for v in z[0:H]]; f = [sig(v) for v in z[H:2 * H]]
        g = [math.tanh(v) for v in z[2 * H:3 * H]]; o = [sig(v) for v in z[3 * H:4 * H]]
        c = [f[k] * c[k] + i[k] * g[k] for k in range(H)]
        h = [o[k] * math.tanh(c[k]) for k in range(H)]
        return h
    return step

def run(step, dense, knobs, x, in_gain=1.0, skip=False, out_gain=1.0):
    for _ in range(PREWARM):
        step([0.0] + knobs)
    y = []
    for s in x:
        v = s * in_gain
        out = dense(step([v] + knobs))
        y.append(out + v if skip else out * out_gain)
    return y

def write(name, model, knobs, x, y):
    with open(os.path.join(HERE, name + ".json"), "w") as f:
        json.dump(model, f)
    with open(os.path.join(HERE, name + ".expect.json"), "w") as f:
        json.dump({"knobs": knobs, "x": x, "y": y}, f)

def proteus(name, unit, H, inputs, knobs, seed, rate=None):
    rng = random.Random(seed)
    G = 4 if unit == "LSTM" else 3
    w_ih, w_hh, b_ih, b_hh = mat(rng, G * H, inputs), mat(rng, G * H, H), vec(rng, G * H), vec(rng, G * H)
    lw, lb = mat(rng, 1, H), vec(rng, 1)
    md = {"model": "SimpleRNN", "input_size": inputs, "skip": 1, "output_size": 1, "unit_type": unit,
          "num_layers": 1, "hidden_size": H, "bias_fl": True}
    if rate: md["sample_rate"] = rate
    model = {"model_data": md, "state_dict": {"rec.weight_ih_l0": w_ih, "rec.weight_hh_l0": w_hh,
             "rec.bias_ih_l0": b_ih, "rec.bias_hh_l0": b_hh, "lin.weight": lw, "lin.bias": lb}}
    step = (torch_lstm if unit == "LSTM" else torch_gru)(w_ih, w_hh, b_ih, b_hh, H)
    dense = lambda h: sum(lw[0][k] * h[k] for k in range(H)) + lb[0]
    x = signal()
    write(name, model, knobs, x, run(step, dense, knobs, x, skip=True))

def aidax(name, H, inputs, knobs, seed, skip, in_gain_db, out_gain_db):
    rng = random.Random(seed)
    W, U, b = mat(rng, inputs, 4 * H), mat(rng, H, 4 * H), vec(rng, 4 * H)
    dW, db = mat(rng, H, 1), vec(rng, 1)
    model = {"in_shape": [None, None, inputs], "in_skip": 1 if skip else 0, "in_gain": in_gain_db,
             "out_gain": out_gain_db, "metadata": {"samplerate": "48000"},
             "layers": [{"type": "lstm", "activation": "tanh", "shape": [None, None, H], "weights": [W, U, b]},
                        {"type": "dense", "activation": "", "shape": [None, None, 1], "weights": [dW, db]}]}
    step = keras_lstm(W, U, b, H)
    dense = lambda h: sum(h[k] * dW[k][0] for k in range(H)) + db[0]
    x = signal()
    y = run(step, dense, knobs, x, 10 ** (in_gain_db / 20), skip, 10 ** (out_gain_db / 20))
    write(name, model, knobs, x, y)

proteus("proteus_lstm_8x2", "LSTM", 8, 2, [0.3], 1)
proteus("proteus_gru_8x1", "GRU", 8, 1, [], 2)
proteus("proteus_lstm_10x1", "LSTM", 10, 1, [], 3, rate=48000)  # 10 is not compiled in: the generic path
aidax("aidax_lstm_8x2_skip", 8, 2, [0.7], 4, True, 3.0, 0.0)
aidax("aidax_lstm_12x1", 12, 1, [], 5, False, 0.0, -2.0)
aidax("aidax_lstm_10x3", 10, 3, [0.2, 0.9], 6, False, 0.0, 0.0)  # generic path, two knobs
