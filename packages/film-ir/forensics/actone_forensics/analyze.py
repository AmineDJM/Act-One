"""
The forensic analyzer's entry point.

    python3 -m actone_forensics.analyze FILM.mp4 OUT.json --ffmpeg /path/to/ffmpeg [--ocr-hz 6]

Three decodes of the video — measure every frame and read text on a stride;
collect the references the text and panel tracks need; measure every frame
around them — then the audio. Progress goes to stdout as JSON lines, the
result to OUT.json, failures to stderr with a non-zero exit.
"""
import argparse
import hashlib
import json
import os
import platform
import sys
import time
from fractions import Fraction

import av
import cv2
import numpy as np

from . import audio as audio_module
from . import camera, objects, shots, text
from .common import ANALYZER_NAME, ANALYZER_VERSION, emit, r, rl
from .video import WORK_WIDTH, Decoder, _size_for, analyze_video, dominant_hex


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def measured_rate(table, timescale_den, timebase_num):
    """The frame rate the timestamps actually describe: the commonest frame duration."""
    durations = [int(d) for d in table["durations"] if d is not None]
    if not durations:
        return None
    values, counts = np.unique(durations, return_counts=True)
    common = int(values[np.argmax(counts)])
    rate = Fraction(timescale_den, common * timebase_num)
    return {"num": rate.numerator, "den": rate.denominator, "distinct": [{"ticks": str(int(v)), "count": int(c)} for v, c in zip(values, counts)]}


def words_from_glyphs(glyphs):
    words = text.spaced_words(glyphs)
    out = []
    for word in words:
        xs = [g["box"][0] for g in word] + [g["box"][0] + g["box"][2] for g in word]
        ys = [g["box"][1] for g in word] + [g["box"][1] + g["box"][3] for g in word]
        out.append({"text": "".join(g["char"] for g in word), "box": [min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)], "glyphs": word})
    return out


def glyphs_for(line, read):
    """
    The glyphs of one line at its reference frame, from every reading inside its box.

    A line joined from fragments is read back as fragments; their glyphs are
    put in order with a space between them. Readings that are not the line —
    too little of them inside its box, or text that does not match — are left.
    """
    lx, ly, lw, lh = line["referenceBox"]
    inside = []
    for candidate in read:
        cx, cy, cw, ch = text._bbox(candidate["poly"])
        area = max(1.0, cw * ch)
        overlap_w = max(0.0, min(lx + lw, cx + cw) - max(lx, cx))
        overlap_h = max(0.0, min(ly + lh, cy + ch) - max(ly, cy))
        if overlap_w * overlap_h / area >= 0.6:
            inside.append(candidate)
    inside.sort(key=lambda candidate: text._bbox(candidate["poly"])[0])
    if not inside or text.text_similarity(" ".join(c["text"] for c in inside), line["text"]) <= 0.6:
        return []
    glyphs = []
    for k, candidate in enumerate(inside):
        if k > 0 and glyphs and candidate["glyphs"]:
            before, after = glyphs[-1]["box"], candidate["glyphs"][0]["box"]
            gap_x = before[0] + before[2]
            glyphs.append({"char": " ", "box": [gap_x, before[1], max(0.0, after[0] - gap_x), before[3]]})
        glyphs.extend(candidate["glyphs"])
    return glyphs


def respace(line, glyphs):
    """The line's text with the spaces its glyphs show, when the letters are the same letters."""
    words = ["".join(g["char"] for g in word) for word in text.spaced_words(glyphs)]
    if not words:
        return line["text"]
    squeeze = lambda value: "".join(value.split())
    return " ".join(words) if squeeze(" ".join(words)) == squeeze(line["text"]) else line["text"]


def collect_references(path, lines, panel_frames, ocr_engine, width, height):
    """Second decode: each line's settled appearance and glyphs, and each shot's middle frame for panels."""
    decoder = Decoder(path)
    refine_w, refine_h = _size_for(width, height, min(text.REFINE_WIDTH, width))
    ocr_w, ocr_h = _size_for(width, height, min(1280, width))
    work_w, work_h = _size_for(width, height, WORK_WIDTH)
    wanted = {}
    for index, line in enumerate(lines):
        wanted.setdefault(line["referenceFrame"], []).append(index)
    references = [None] * len(lines)
    panel_greys = {}
    last = max(list(wanted) + list(panel_frames) + [0])
    for frame_index, frame in enumerate(decoder.frames()):
        if frame_index in panel_frames:
            panel_greys[frame_index] = cv2.cvtColor(decoder.bgr(frame, work_w, work_h), cv2.COLOR_BGR2GRAY)
        if frame_index in wanted:
            bgr = decoder.bgr(frame, refine_w, refine_h)
            grey = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
            read = ocr_engine.read_glyphs(decoder.bgr(frame, ocr_w, ocr_h), scale=width / float(ocr_w)) if ocr_engine else []
            for index in wanted[frame_index]:
                line = lines[index]
                glyphs = glyphs_for(line, read)
                references[index] = {
                    "grey": grey,
                    "bgr": bgr,
                    "words": words_from_glyphs(glyphs),
                    "glyphs": glyphs,
                }
        if frame_index >= last:
            break
    decoder.close()
    return references, panel_greys


def measure_pass(path, refiner, tracker, width, height, text_windows, panel_windows):
    decoder = Decoder(path)
    refine_w, refine_h = _size_for(width, height, min(text.REFINE_WIDTH, width))
    work_w, work_h = _size_for(width, height, WORK_WIDTH)
    active = lambda windows, f: any(a <= f <= b for a, b in windows)  # noqa: E731
    last = max([b for _, b in text_windows + panel_windows] + [0])
    for frame_index, frame in enumerate(decoder.frames()):
        if active(text_windows, frame_index):
            grey = cv2.cvtColor(decoder.bgr(frame, refine_w, refine_h), cv2.COLOR_BGR2GRAY)
            refiner.measure(frame_index, grey)
        if active(panel_windows, frame_index):
            grey = cv2.cvtColor(decoder.bgr(frame, work_w, work_h), cv2.COLOR_BGR2GRAY)
            tracker.measure(frame_index, grey)
        if frame_index % 120 == 0:
            emit("tracks", frame_index / float(max(1, last)), f"{frame_index} frames")
        if frame_index >= last:
            break
    decoder.close()


def main(argv=None):
    parser = argparse.ArgumentParser(prog="actone_forensics")
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--ocr-hz", type=float, default=6.0)
    parser.add_argument("--no-ocr", action="store_true")
    args = parser.parse_args(argv)
    started = time.time()
    warnings = []

    emit("probe", 0.0, "reading the container")
    info = __import__("actone_forensics.probe", fromlist=["probe"]).probe(args.input)
    if info["video"] is None:
        raise SystemExit("the file has no video stream")
    digest = sha256_of(args.input)
    size = os.path.getsize(args.input)

    average = info["video"]["averageFrameRate"]
    nominal_fps = average["num"] / float(average["den"]) if average else 30.0
    stride = max(1, int(round(nominal_fps / args.ocr_hz)))
    ocr_engine = None if args.no_ocr else text.OcrEngine()

    emit("video", 0.0, "measuring every frame")
    video = analyze_video(args.input, ocr=ocr_engine, ocr_stride=stride)
    if video["assumedMatrix"]:
        warnings.append(f"colour matrix not tagged; decoded as {video['assumedMatrix']}")
    table = video["table"]
    n = len(table["pts"])
    timebase = info["video"]["timebase"]
    rate = measured_rate(table, timebase["den"], timebase["num"])
    fps = rate["num"] / float(rate["den"]) if rate else nominal_fps

    emit("structure", 0.0, "boundaries")
    segmentation = shots.segment(video["features"], video["vectors"], table["repeatOf"], video["smallGrey"], fps)
    fields = shots.field_changes(video["vectors"], fps)
    work = video["work"]
    cam = camera.trajectories(segmentation["shots"], video["homographies"], video["features"], fps, work["width"], work["height"])

    emit("text", 0.0, "linking readings")
    lines = text.merge_row_fragments(text.link(video["ocrFrames"], stride, video["width"]), stride)
    blocks = text.group_blocks(lines)
    panel_frames = {(a + b) // 2 for a, b in segmentation["shots"] if b - a >= 2}
    emit("tracks", 0.0, "collecting references")
    references, panel_greys = collect_references(args.input, lines, panel_frames, ocr_engine, video["width"], video["height"])
    for line, reference in zip(lines, references):
        if reference and reference["glyphs"]:
            spaced = respace(line, reference["glyphs"])
            if spaced != line["text"]:
                line["variants"] = sorted(set(line["variants"]) | {line["text"]})[:8]
                line["text"] = spaced
    usable = [i for i, ref in enumerate(references) if ref is not None]
    if len(usable) < len(lines):
        warnings.append(f"{len(lines) - len(usable)} text line(s) had no reference frame to measure against")
    kept_lines = [lines[i] for i in usable]
    kept_references = [references[i] for i in usable]
    cuts = [b["firstIncoming"] for b in segmentation["boundaries"] if b["kind"] == "hard_cut"]
    refiner = text.Refiner(kept_lines, kept_references, video["width"], video["height"], fps, n, cuts)
    tracker = objects.PanelTracker(segmentation["shots"], panel_greys, video["width"] / float(work["width"]), fps)
    text_windows = refiner.windows()
    panel_windows = [(p["first"], p["last"]) for p in tracker.panels]
    emit("tracks", 0.0, "measuring text and panels on every frame")
    measure_pass(args.input, refiner, tracker, video["width"], video["height"], text_windows, panel_windows)
    refined = refiner.results()
    panels = tracker.results(video["width"], video["height"])

    audio_report = None
    if info["audio"]:
        stream = info["audio"][0]
        audio_report = audio_module.analyze_audio(args.input, args.ffmpeg, stream["index"])
        if not audio_report["loudness"]["ok"]:
            warnings.append("EBU R128 loudness could not be measured by FFmpeg")
        if audio_report["gaps"]:
            warnings.append(f"the audio stream has {len(audio_report['gaps'])} timestamp discontinuities")

    emit("write", 0.0, "writing the report")
    line_index = {id(line): i for i, line in enumerate(kept_lines)}
    report = {
        "analyzer": {
            "name": ANALYZER_NAME,
            "version": ANALYZER_VERSION,
            "python": platform.python_version(),
            "numpy": np.__version__,
            "opencv": cv2.__version__,
            "pyav": av.__version__,
            "ffmpeg": av.library_versions.get("libavcodec") and ".".join(str(v) for v in av.library_versions["libavcodec"]),
            "ocr": "rapidocr_onnxruntime (PP-OCR)" if ocr_engine else None,
            "seconds": round(time.time() - started, 2),
        },
        "input": {"sha256": digest, "bytes": size, "filename": os.path.basename(args.input)},
        "probe": info,
        "video": {
            "width": video["width"],
            "height": video["height"],
            "work": work,
            "flow": video["flow"],
            "colour": video["colour"],
            "assumedMatrix": video["assumedMatrix"],
            "measuredRate": rate,
            "ocrStride": stride if ocr_engine else None,
            "ocrFrames": len(video["ocrFrames"]),
        },
        "frames": {
            "count": n,
            "pts": table["pts"],
            "durations": table["durations"],
            "keyframe": table["keyframe"],
            "pictureType": table["pictureType"],
            "hash": table["hash"],
            "repeatOf": table["repeatOf"],
            "features": {name: rl(values, 6) for name, values in video["features"].items()},
            "vectors": {
                "hue_histogram": [rl(v, 4) for v in video["vectors"]["hue_histogram"]],
                "dominant_colours": [[[r(c, 2) for c in entry] for entry in frame] for frame in video["vectors"]["dominant_colours"]],
                "border_rgb": [rl(v, 2) for v in video["vectors"]["border_rgb"]],
            },
        },
        "boundaries": segmentation["boundaries"],
        "shots": segmentation["shots"],
        "shotColours": [dominant_hex(np.mean(np.array(video["vectors"]["dominant_colours"][a: b + 1]), axis=0).tolist()) for a, b in segmentation["shots"]],
        "fieldChanges": fields,
        "camera": {
            "samples": {name: rl(values, 6) for name, values in cam["samples"].items()},
            "shots": cam["shots"],
            "moves": cam["moves"],
        },
        "text": {
            "stride": stride,
            "framesRead": len(video["ocrFrames"]),
            "lines": [dict(line, refinement=result, glyphs=(ref or {}).get("glyphs", []), words=(ref or {}).get("words", []))
                      for line, result, ref in zip(kept_lines, refined, kept_references)],
            "blocks": [[line_index[id(lines[k])] for k in block if id(lines[k]) in line_index] for block in blocks],
        },
        "panels": panels,
        "audio": audio_report,
        "warnings": warnings,
    }
    if audio_report:
        audio_report["series"] = {name: rl(values, 4) for name, values in audio_report["series"].items()}
    with open(args.output, "w") as handle:
        json.dump(clean(report), handle, allow_nan=False)
    emit("done", 1.0, f"{n} frames in {report['analyzer']['seconds']}s")


def clean(value):
    """JSON has no NaN and no infinity; a value that is not a finite number is reported as absent."""
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    if isinstance(value, np.ndarray):
        return clean(value.tolist())
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        v = float(value)
        return v if np.isfinite(v) else None
    return value


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as error:  # noqa: BLE001 - the caller gets the reason on stderr and a non-zero exit
        import traceback

        traceback.print_exc(file=sys.stderr)
        sys.stderr.write(f"forensics failed: {error}\n")
        sys.exit(2)
