"""
The sound, as signal.

Decoded at its own sample rate, never resampled for storage. Curves are on a
10 ms hop whose k-th value belongs to sample k·hop exactly; events that can be
located more finely than the hop — onsets, the edges of silences, where a
voice starts — are refined to the sample. Loudness is FFmpeg's EBU R128
implementation, the standard's own reference behaviour.

There is no source-separation model here. Voice, music and effects are
probabilities estimated from spectral shape, syllabic modulation, periodicity
and rhythm; they say "this sounds like speech", not "this is the voice stem".
"""
import re
import subprocess

import av
import numpy as np

from .common import emit

WINDOW = 2048
VOICE_BAND = (300.0, 3400.0)
BANDS = [("sub", 20, 60), ("low", 60, 250), ("low_mid", 250, 500), ("mid", 500, 2000), ("high_mid", 2000, 4000), ("presence", 4000, 6000), ("brilliance", 6000, 20000)]
SILENCE_DB = -60.0


def decode(path, stream_index):
    container = av.open(path)
    try:
        stream = next(s for s in container.streams.audio if s.index == stream_index)
        resampler = av.AudioResampler(format="fltp", layout=stream.layout, rate=stream.rate)
        chunks, first_pts, expected, gaps = [], None, None, []
        for frame in container.decode(stream):
            if first_pts is None and frame.pts is not None:
                first_pts = int(frame.pts)
            if frame.pts is not None and expected is not None and int(frame.pts) != expected:
                gaps.append({"expectedPts": str(expected), "pts": str(int(frame.pts))})
            for converted in resampler.resample(frame):
                chunks.append(converted.to_ndarray())
            if frame.pts is not None:
                expected = int(frame.pts) + int(frame.samples * stream.time_base.denominator / (stream.rate * stream.time_base.numerator)) if stream.time_base else None
        for converted in resampler.resample(None):
            chunks.append(converted.to_ndarray())
        samples = np.concatenate(chunks, axis=1).astype(np.float32) if chunks else np.zeros((1, 0), np.float32)
        return {
            "samples": samples,
            "rate": int(stream.rate),
            "firstPts": str(first_pts) if first_pts is not None else None,
            "timebase": {"num": int(stream.time_base.numerator), "den": int(stream.time_base.denominator)},
            "gaps": gaps[:20],
        }
    finally:
        container.close()


def _frames(signal, hop, window):
    padded = np.pad(signal, (window // 2, window // 2 + hop))
    count = 1 + (len(signal) - 1) // hop if len(signal) else 0
    shape = (count, window)
    strides = (padded.strides[0] * hop, padded.strides[0])
    return np.lib.stride_tricks.as_strided(padded, shape=shape, strides=strides), count


def _db(values, floor=1e-10):
    return 20 * np.log10(np.maximum(values, floor))


def loudness(path, ffmpeg, stream_index):
    """EBU R128 through FFmpeg's ebur128 filter: momentary and short-term every 100 ms, then the programme figures."""
    command = [ffmpeg, "-nostats", "-hide_banner", "-nostdin", "-i", path, "-map", f"0:{stream_index}",
               "-af", "ebur128=peak=true+sample:framelog=info", "-f", "null", "-"]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=1800)
    text = completed.stderr
    momentary, short_term, times = [], [], []
    for match in re.finditer(r"t:\s*([0-9.]+)\s+TARGET:\S+\s+LUFS\s+M:\s*(-?[0-9.inf]+)\s+S:\s*(-?[0-9.inf]+)", text):
        times.append(round(float(match.group(1)) * 10))
        momentary.append(_number(match.group(2)))
        short_term.append(_number(match.group(3)))
    summary = text[text.rfind("Summary:"):] if "Summary:" in text else ""
    integrated = re.search(r"I:\s*(-?[0-9.]+)\s*LUFS", summary)
    lra = re.search(r"LRA:\s*(-?[0-9.]+)\s*LU", summary)
    true_peak = re.search(r"True peak:\s*\n\s*Peak:\s*(-?[0-9.inf]+)\s*dBFS", summary)
    sample_peak = re.search(r"Sample peak:\s*\n\s*Peak:\s*(-?[0-9.inf]+)\s*dBFS", summary)
    return {
        "ok": completed.returncode == 0 and bool(times),
        "blockIndices": times,
        "momentary": momentary,
        "shortTerm": short_term,
        "integratedLufs": float(integrated.group(1)) if integrated else None,
        "loudnessRangeLu": float(lra.group(1)) if lra else None,
        "truePeakDbtp": _number(true_peak.group(1)) if true_peak else None,
        "samplePeakDbfs": _number(sample_peak.group(1)) if sample_peak else None,
    }


def _number(text):
    try:
        value = float(text)
    except ValueError:
        return None
    return value if np.isfinite(value) else None


def _yin(frames, rate, fmin=60.0, fmax=500.0, threshold=0.15):
    """de Cheveigné & Kawahara (2002), vectorised over frames. Returns f0 (Hz) and aperiodicity per frame."""
    tau_min, tau_max = int(rate / fmax), int(rate / fmin)
    width = frames.shape[1] - tau_max
    if width <= tau_min:
        return np.full(len(frames), np.nan), np.full(len(frames), np.nan)
    x = frames.astype(np.float64)
    size = 1 << int(np.ceil(np.log2(frames.shape[1] + width)))
    spectrum_full = np.fft.rfft(x, size, axis=1)
    spectrum_head = np.fft.rfft(x[:, :width], size, axis=1)
    cross = np.fft.irfft(spectrum_full * np.conj(spectrum_head), size, axis=1)[:, : tau_max + 1]
    squares = np.cumsum(x ** 2, axis=1)
    energy_head = squares[:, width - 1]
    taus = np.arange(tau_max + 1)
    energy_shift = squares[:, taus + width - 1] - np.concatenate([np.zeros((len(x), 1)), squares[:, taus[1:] - 1]], axis=1)
    difference = energy_head[:, None] + energy_shift - 2 * cross
    difference[:, 0] = 0
    cumulative = np.cumsum(difference[:, 1:], axis=1)
    normalised = np.ones_like(difference)
    normalised[:, 1:] = difference[:, 1:] * taus[1:] / np.maximum(cumulative, 1e-12)
    f0 = np.full(len(x), np.nan)
    aperiodicity = np.full(len(x), np.nan)
    for i in range(len(x)):
        row = normalised[i]
        below = np.where(row[tau_min: tau_max] < threshold)[0]
        if len(below) == 0:
            continue
        tau = below[0] + tau_min
        while tau + 1 < tau_max and row[tau + 1] < row[tau]:
            tau += 1
        if 1 <= tau < len(row) - 1:
            a, b, c = row[tau - 1], row[tau], row[tau + 1]
            shift = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) != 0 else 0.0
        else:
            shift = 0.0
        f0[i] = rate / (tau + shift)
        aperiodicity[i] = row[tau]
    return f0, aperiodicity


def _refine_rise(signal, around, radius, rate):
    """The sample where a short-window energy envelope rises fastest, near `around`."""
    lo, hi = max(0, around - radius), min(len(signal), around + radius)
    if hi - lo < 8:
        return around
    segment = signal[max(0, lo - 64): hi].astype(np.float64)
    width = max(8, int(rate * 0.001))
    envelope = np.sqrt(np.convolve(segment ** 2, np.ones(width) / width, mode="same"))
    rise = np.diff(envelope)
    offset = max(0, lo - 64)
    start = lo - offset
    if start >= len(rise):
        return around
    return offset + start + int(np.argmax(rise[start:]))


def _refine_crossing(signal, around, radius, rate, level_db, rising):
    """The first sample, near `around`, where a 5 ms RMS crosses `level_db` in the given direction."""
    lo, hi = max(0, around - radius), min(len(signal), around + radius)
    if hi - lo < 8:
        return around
    width = max(8, int(rate * 0.005))
    segment = signal[lo:hi].astype(np.float64)
    rms = np.sqrt(np.convolve(segment ** 2, np.ones(width) / width, mode="same"))
    above = _db(rms) > level_db
    changes = np.where(above[1:] != above[:-1])[0]
    for change in changes:
        if bool(above[change + 1]) == rising:
            return lo + int(change) + 1
    return around


def _runs(flags, minimum):
    runs, start = [], None
    for i, flag in enumerate(list(flags) + [False]):
        if flag and start is None:
            start = i
        elif not flag and start is not None:
            if i - start >= minimum:
                runs.append((start, i - 1))
            start = None
    return runs


def _tempo_and_beats(onset, hop_seconds):
    """Tempo from the onset envelope's autocorrelation, beats by dynamic programming (Ellis, 2007)."""
    if len(onset) < 400:
        return None, [], 0.0
    envelope = onset - onset.mean()
    correlation = np.correlate(envelope, envelope, mode="full")[len(envelope) - 1:]
    lags = np.arange(len(correlation))
    bpm = np.where(lags > 0, 60.0 / (np.maximum(lags, 1) * hop_seconds), 0)
    prior = np.exp(-0.5 * (np.log2(np.maximum(bpm, 1e-6) / 120.0) / 0.9) ** 2)
    valid = (bpm >= 60) & (bpm <= 200)
    if not valid.any() or correlation[0] <= 0:
        return None, [], 0.0
    weighted = np.where(valid, correlation * prior, -np.inf)
    period = int(np.argmax(weighted))
    strength = float(correlation[period] / correlation[0])
    if strength < 0.05:
        return None, [], strength
    tightness = 100.0
    score = onset.astype(np.float64).copy()
    back = np.full(len(onset), -1)
    for t in range(len(onset)):
        lo, hi = t - 2 * period, t - period // 2
        if hi <= 0:
            continue
        candidates = np.arange(max(0, lo), hi)
        penalty = -tightness * (np.log((t - candidates) / float(period))) ** 2
        best = int(np.argmax(score[candidates] + penalty))
        score[t] = onset[t] + score[candidates[best]] + penalty[best]
        back[t] = candidates[best]
    t = int(np.argmax(score[-period:])) + len(onset) - period
    beats = []
    while t >= 0:
        beats.append(t)
        t = back[t]
    beats.reverse()
    return 60.0 / (period * hop_seconds), beats, strength


KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _key(magnitude, frequencies, weights):
    usable = (frequencies >= 60) & (frequencies <= 5000)
    classes = (np.round(12 * np.log2(frequencies[usable] / 440.0)) + 9) % 12
    profile = np.zeros(12)
    energy = (magnitude[:, usable] ** 2) * weights[:, None]
    for pc in range(12):
        profile[pc] = energy[:, classes == pc].sum()
    if profile.sum() <= 0:
        return None
    scores = []
    for tonic in range(12):
        rotated = np.roll(profile, -tonic)
        scores.append((float(np.corrcoef(rotated, KK_MAJOR)[0, 1]), f"{PITCH_CLASSES[tonic]} major"))
        scores.append((float(np.corrcoef(rotated, KK_MINOR)[0, 1]), f"{PITCH_CLASSES[tonic]} minor"))
    scores.sort(reverse=True)
    return {"key": scores[0][1], "correlation": scores[0][0], "margin": scores[0][0] - scores[1][0], "runnerUp": scores[1][1]}


def analyze_audio(path, ffmpeg, stream_index):
    emit("audio", 0.05, "decoding")
    decoded = decode(path, stream_index)
    rate = decoded["rate"]
    samples = decoded["samples"]
    mono = samples.mean(axis=0) if samples.shape[0] > 1 else samples[0]
    count = len(mono)
    hop = int(round(rate * 0.01))
    frames, n = _frames(mono, hop, WINDOW)
    emit("audio", 0.2, "spectrum")
    window = np.hanning(WINDOW).astype(np.float32)
    magnitude = np.abs(np.fft.rfft(frames * window, axis=1)).astype(np.float32)
    frequencies = np.fft.rfftfreq(WINDOW, 1.0 / rate)
    power = magnitude ** 2
    total = power.sum(axis=1) + 1e-12
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1))
    rms_db = _db(rms)
    peak_windows, _ = _frames(np.abs(mono), hop, hop)
    peak_db = _db(peak_windows.max(axis=1))
    centroid = (power * frequencies).sum(axis=1) / total
    cumulative = np.cumsum(power, axis=1)
    rolloff = frequencies[np.minimum(len(frequencies) - 1, (cumulative < 0.85 * cumulative[:, -1:]).sum(axis=1))]
    flatness = np.exp(np.mean(np.log(power + 1e-12), axis=1)) / (np.mean(power, axis=1) + 1e-12)
    log_magnitude = np.log1p(100 * magnitude)
    flux = np.zeros(n)
    flux[1:] = np.maximum(0, np.diff(log_magnitude, axis=0)).sum(axis=1)
    zcr = np.mean(np.abs(np.diff(np.sign(frames), axis=1)) > 0, axis=1)
    bands = {}
    for name, lo, hi in BANDS:
        mask = (frequencies >= lo) & (frequencies < min(hi, rate / 2))
        bands[name] = _db(np.sqrt(power[:, mask].sum(axis=1) / WINDOW)) if mask.any() else np.full(n, np.nan)
    voice_mask = (frequencies >= VOICE_BAND[0]) & (frequencies <= VOICE_BAND[1])
    speechy_mask = (frequencies >= 60) & (frequencies <= 8000)
    voice_share = power[:, voice_mask].sum(axis=1) / (power[:, speechy_mask].sum(axis=1) + 1e-12)

    emit("audio", 0.4, "pitch")
    audible = rms_db > -45
    f0 = np.full(n, np.nan)
    aperiodicity = np.full(n, np.nan)
    if audible.any():
        indices = np.where(audible)[0]
        for start in range(0, len(indices), 2000):
            chunk = indices[start: start + 2000]
            pitch, aper = _yin(frames[chunk], rate)
            f0[chunk] = pitch
            aperiodicity[chunk] = aper

    # Speech-likeness: the voice band's own envelope modulated at syllable rate,
    # voiced and unvoiced stretches alternating several times a second, and a
    # pitch that moves (intonation) rather than holding (a sung or played note).
    voice_envelope = np.sqrt(power[:, voice_mask].sum(axis=1))
    voice_envelope = voice_envelope / (voice_envelope.max() + 1e-12)
    periodic = (~np.isnan(f0)) & (f0 >= 70) & (f0 <= 400) & (np.nan_to_num(aperiodicity, nan=1) < 0.25)
    modulation = np.zeros(n)
    alternation = np.zeros(n)
    voiced_share = np.zeros(n)
    intonation = np.zeros(n)
    half = 50
    log_f0 = np.where(periodic, np.log2(np.where(periodic, f0, 1.0)), np.nan)
    for i in range(n):
        lo, hi = max(0, i - half), min(n, i + half)
        segment = voice_envelope[lo:hi]
        if len(segment) < 32:
            continue
        spectrum = np.abs(np.fft.rfft(segment - segment.mean()))
        freqs = np.fft.rfftfreq(len(segment), 0.01)
        modulation[i] = spectrum[(freqs >= 3) & (freqs <= 9)].sum() / (spectrum[(freqs >= 1) & (freqs <= 20)].sum() + 1e-9)
        voiced = periodic[lo:hi]
        voiced_share[i] = voiced.mean()
        alternation[i] = np.count_nonzero(voiced[1:] != voiced[:-1]) / ((hi - lo) * 0.01)
        pitches = log_f0[lo:hi][voiced]
        intonation[i] = float(np.std(pitches)) if len(pitches) >= 8 else 0.0
    score = (
        3.0 * (modulation - 0.4)
        + 2.0 * (voice_share - 0.6)
        + 0.3 * (np.minimum(alternation, 12) - 5)
        + 6.0 * (np.minimum(intonation, 0.35) - 0.08)
        - 3.0 * (np.abs(voiced_share - 0.5) > 0.35)
        - 3.0 * (flatness > 0.4)
    )
    voice_probability = np.where(audible, 1 / (1 + np.exp(-score)), 0.0)
    voice_probability = np.convolve(voice_probability, np.ones(5) / 5, mode="same")

    emit("audio", 0.6, "rhythm")
    onset = flux / (flux.max() + 1e-12)
    tempo, beats, beat_strength = _tempo_and_beats(onset, hop / float(rate))
    local_periodicity = np.zeros(n)
    if tempo:
        period = int(round(60.0 / tempo / (hop / float(rate))))
        for i in range(0, n, 25):
            segment = onset[max(0, i - 150): i + 150]
            if len(segment) > period * 2:
                seg = segment - segment.mean()
                denominator = float((seg * seg).sum()) + 1e-12
                local = float((seg[:-period] * seg[period:]).sum()) / denominator
                local_periodicity[i: i + 25] = max(0.0, local)
    tonal = 1 - np.clip(flatness * 3, 0, 1)
    music_score = 3 * (local_periodicity - 0.1) + 2 * (tonal - 0.6) + 1.5 * (bands["low"] > -45) - 2 * (voice_probability > 0.7)
    music_probability = np.where(audible, 1 / (1 + np.exp(-music_score)), 0.0)

    emit("audio", 0.7, "events")
    events = []
    median_window = 50
    threshold = np.array([np.median(onset[max(0, i - median_window): i + median_window]) for i in range(n)]) + 0.5 * onset.std()
    for i in range(2, n - 2):
        if onset[i] >= threshold[i] and onset[i] == onset[max(0, i - 5): i + 6].max() and onset[i] > 0.05 and rms_db[i] > -50:
            sample = _refine_rise(mono, i * hop, hop, rate)
            later = min(n - 1, i + 15)
            decay = float(rms_db[later] - rms_db[i])
            high_share = float(power[i, frequencies > 4000].sum() / total[i])
            kind = "transient" if decay < -6 and high_share > 0.1 else "onset"
            events.append({"kind": kind, "sample": int(sample), "hop": i, "magnitude": float(onset[i]), "decayDb": decay, "highShare": high_share, "centroidHz": float(centroid[i])})
    silent = rms_db < SILENCE_DB
    silences = []
    for a, b in _runs(silent, 20):
        start = _refine_crossing(mono, a * hop, hop, rate, SILENCE_DB, rising=False) if a > 0 else 0
        end = _refine_crossing(mono, (b + 1) * hop, hop, rate, SILENCE_DB, rising=True) if b + 1 < n else count
        silences.append({"startSample": int(start), "endSample": int(min(count, end)), "levelDb": float(np.median(rms_db[a: b + 1]))})
    voiced = voice_probability > 0.5
    voice_spans = []
    for a, b in _runs(voiced, 15):
        start = _refine_crossing(mono, a * hop, 3 * hop, rate, float(np.median(rms_db[a: b + 1]) - 20), rising=True)
        end = _refine_crossing(mono, (b + 1) * hop, 3 * hop, rate, float(np.median(rms_db[a: b + 1]) - 20), rising=False)
        voice_spans.append({"startSample": int(start), "endSample": int(end), "meanProbability": float(voice_probability[a: b + 1].mean())})

    ducking = []
    outside_voice = 10 * np.log10(np.maximum(1e-12, 10 ** (bands["low"] / 10) + 10 ** (bands["presence"] / 10) + 10 ** (bands["brilliance"] / 10)))
    for span in voice_spans:
        a, b = span["startSample"] // hop, span["endSample"] // hop
        before = outside_voice[max(0, a - 100): max(0, a - 10)]
        during = outside_voice[a: b]
        if len(before) >= 20 and len(during) >= 20 and float(np.median(music_probability[max(0, a - 100): a])) > 0.5:
            ducking.append({"startSample": span["startSample"], "endSample": span["endSample"], "depthDb": float(np.median(before) - np.median(during))})

    key = _key(magnitude, frequencies, music_probability * audible)

    emit("audio", 0.85, "loudness")
    measured_loudness = loudness(path, ffmpeg, stream_index)

    beat_samples = []
    onset_samples = np.array([e["sample"] for e in events]) if events else np.array([])
    for b in beats:
        target = b * hop
        if len(onset_samples):
            nearest = onset_samples[np.argmin(np.abs(onset_samples - target))]
            if abs(int(nearest) - target) <= int(0.035 * rate):
                beat_samples.append({"sample": int(nearest), "snapped": True})
                continue
        beat_samples.append({"sample": int(target), "snapped": False})
    downbeat = None
    if len(beats) >= 16:
        accents = [float(np.mean([onset[beats[k]] for k in range(phase, len(beats), 4)])) for phase in range(4)]
        order = np.argsort(accents)[::-1]
        contrast = accents[order[0]] / max(1e-9, accents[order[1]])
        downbeat = {"phase": int(order[0]), "contrast": contrast}

    return {
        "rate": rate,
        "channels": int(samples.shape[0]),
        "samples": int(count),
        "firstPts": decoded["firstPts"],
        "timebase": decoded["timebase"],
        "gaps": decoded["gaps"],
        "hop": hop,
        "window": WINDOW,
        "series": {
            "rms_db": rms_db.tolist(),
            "peak_db": peak_db.tolist(),
            "spectral_centroid_hz": centroid.tolist(),
            "spectral_rolloff_hz": rolloff.tolist(),
            "spectral_flatness": flatness.tolist(),
            "spectral_flux": flux.tolist(),
            "onset_strength": onset.tolist(),
            "zero_crossing_rate": zcr.tolist(),
            "voice_band_share": voice_share.tolist(),
            "syllabic_modulation": modulation.tolist(),
            "voiced_share": voiced_share.tolist(),
            "voicing_alternation_hz": alternation.tolist(),
            "intonation_octaves": intonation.tolist(),
            "pitch_hz": [None if np.isnan(v) else float(v) for v in f0],
            "aperiodicity": [None if np.isnan(v) else float(v) for v in aperiodicity],
            "voice_probability": voice_probability.tolist(),
            "music_probability": music_probability.tolist(),
            **{f"band_{name}_db": values.tolist() for name, values in bands.items()},
        },
        "events": events,
        "silences": silences,
        "voiceSpans": voice_spans,
        "ducking": ducking,
        "tempo": {"bpm": tempo, "strength": beat_strength},
        "beats": beat_samples,
        "downbeat": downbeat,
        "key": key,
        "loudness": measured_loudness,
    }
