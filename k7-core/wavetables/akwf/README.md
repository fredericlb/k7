# AKWF wavetables

Built from the **Adventure Kid Waveforms** by Kristoffer Ekstrand — single-cycle waveforms released
under **CC0 1.0** (public domain, see LICENSE.md beside this file):
https://github.com/KristofferKarlAxelEkstrand/AKWF-FREE

Each table is one AKWF family (`AKWF/AKWF_<family>/`): up to 16 of its waveforms taken evenly across
the family in file order, each resampled from 600 to 2048 samples (cyclic cubic interpolation),
DC removed and normalised to -0.4 dBFS, laid end to end. The wavetable instrument's Position sweeps
across them, so a table is a walk through the family rather than one sound.
