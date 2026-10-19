// measure.rs — the mono sum, the bucketed peak/RMS/bands and the tempo onset envelope, operation for operation ../src/envelope.ts.
// A reader would get wrong the f32 stores: JS keeps these arrays as Float32Array, so a value is rounded to f32 when stored, and here too.

/** One bucket per 256 frames, capped so a long file coarsens while a one-shot keeps near-full detail. */
pub const FRAMES_PER_BUCKET: usize = 256;
pub const MAX_BUCKETS: usize = 8192;

/// JUCE's mono sum of interleaved frames, appended: the first one or two channels averaged, as monoFromInterleaved.
pub fn push_mono(mono: &mut Vec<f32>, samples: &[f32], channels: usize) {
    if channels == 0 {
        return;
    }
    let use_ch = channels.min(2);
    let frames = samples.len() / channels;
    mono.reserve(frames);
    for f in 0..frames {
        let mut sum = 0.0f64;
        for c in 0..use_ch {
            sum += f64::from(samples[f * channels + c]);
        }
        mono.push((sum / use_ch as f64) as f32);
    }
}

/// What a measure gives back: the bucket arrays and the tempo onset envelope, all as JS's Float32Arrays hold them.
#[derive(Debug, Clone, PartialEq)]
pub struct Measured {
    pub peak: Vec<f32>,
    pub rms: Vec<f32>,
    pub low: Vec<f32>,
    pub mid: Vec<f32>,
    pub high: Vec<f32>,
    pub tempo: Vec<f32>,
}

/// The envelope's pass over every sample, given the two followers' coefficients JS computed with Math.exp.
pub struct Measure;

impl Measure {
    #[must_use]
    pub fn run(mono: &[f32], a_low: f64, a_high: f64) -> Measured {
        let frames = mono.len();
        let buckets = if frames == 0 {
            1
        } else {
            frames.div_ceil(FRAMES_PER_BUCKET).clamp(1, MAX_BUCKETS)
        };
        let mut peak = vec![0f32; buckets];
        let mut sum_sq = vec![0f64; buckets];
        let mut count = vec![0f64; buckets];
        let mut low = vec![0f32; buckets];
        let mut mid = vec![0f32; buckets];
        let mut high = vec![0f32; buckets];
        let fpb = if frames > 0 {
            frames as f64 / buckets as f64
        } else {
            1.0
        };
        let mut tempo = vec![0f32; frames.div_ceil(FRAMES_PER_BUCKET)];
        let (mut lp_low, mut lp_high) = (0.0f64, 0.0f64);

        for (pos, &s) in mono.iter().enumerate() {
            let v = f64::from(s);
            let b = ((pos as f64 / fpb).floor() as usize).min(buckets - 1);
            let a = v.abs();
            if a > f64::from(peak[b]) {
                peak[b] = a as f32;
            }
            lp_low += a_low * (v - lp_low);
            lp_high += a_high * (v - lp_high);
            let lo = lp_low.abs();
            let md = (lp_high - lp_low).abs();
            let hi = (v - lp_high).abs();
            if lo > f64::from(low[b]) {
                low[b] = lo as f32;
            }
            if md > f64::from(mid[b]) {
                mid[b] = md as f32;
            }
            if hi > f64::from(high[b]) {
                high[b] = hi as f32;
            }
            sum_sq[b] += v * v;
            count[b] += 1.0;
            let h = pos / FRAMES_PER_BUCKET;
            if h < tempo.len() && a > f64::from(tempo[h]) {
                tempo[h] = a as f32;
            }
        }

        // Half-wave-rectified first difference, backwards so each step reads its untouched predecessor.
        for i in (1..tempo.len()).rev() {
            tempo[i] = (f64::from(tempo[i]) - f64::from(tempo[i - 1])).max(0.0) as f32;
        }
        if let Some(t) = tempo.first_mut() {
            *t = 0.0;
        }
        let rms = (0..buckets)
            .map(|b| {
                if count[b] > 0.0 {
                    (sum_sq[b] / count[b]).sqrt() as f32
                } else {
                    0.0
                }
            })
            .collect();
        Measured {
            peak,
            rms,
            low,
            mid,
            high,
            tempo,
        }
    }
}

/// detectBpm's correlation at every lag in [min_lag, max_lag], on the mean-removed onset envelope, as its corr() sums it.
#[must_use]
pub fn autocorr(onset: &[f32], min_lag: usize, max_lag: usize) -> Vec<f64> {
    let mut mean = 0.0f64;
    for &v in onset {
        mean += f64::from(v);
    }
    mean /= onset.len() as f64;
    let x: Vec<f64> = onset.iter().map(|&v| f64::from(v) - mean).collect();
    (min_lag..=max_lag)
        .map(|lag| {
            let n = x.len().saturating_sub(lag);
            let mut sum = 0.0f64;
            for i in 0..n {
                sum += x[i] * x[i + lag];
            }
            sum / n as f64
        })
        .collect()
}
