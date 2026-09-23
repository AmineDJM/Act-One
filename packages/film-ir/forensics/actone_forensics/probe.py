"""
What the file says about itself, read from the container and the codec
contexts. Every value here is reported verbatim: a declared frame rate is a
declaration, and the decoded timestamps are what decide it later.
"""
import av

# FFmpeg's enum values, named. Anything not listed is reported as its number.
COLOR_RANGE = {0: None, 1: "tv", 2: "pc"}
COLOR_PRIMARIES = {1: "bt709", 2: None, 4: "bt470m", 5: "bt470bg", 6: "smpte170m", 7: "smpte240m", 8: "film", 9: "bt2020", 10: "smpte428", 11: "smpte431", 12: "smpte432", 22: "jedec-p22"}
COLOR_TRC = {1: "bt709", 2: None, 4: "gamma22", 5: "gamma28", 6: "smpte170m", 7: "smpte240m", 8: "linear", 13: "iec61966-2-1", 14: "bt2020-10", 15: "bt2020-12", 16: "smpte2084", 18: "arib-std-b67"}
COLOR_SPACE = {0: "gbr", 1: "bt709", 2: None, 4: "fcc", 5: "bt470bg", 6: "smpte170m", 7: "smpte240m", 8: "ycgco", 9: "bt2020nc", 10: "bt2020c"}


def _named(table, value):
    if value is None:
        return None
    try:
        key = int(value)
    except (TypeError, ValueError):
        return str(value)
    return table.get(key, str(key))


def _fraction(value):
    if value is None:
        return None
    try:
        num, den = int(value.numerator), int(value.denominator)
    except AttributeError:
        return None
    return {"num": num, "den": den} if den > 0 and num > 0 else None


def _rational_duration(duration, time_base):
    """A duration in stream ticks, as exact ticks over the stream's denominator."""
    if duration is None or time_base is None:
        return None
    return {"ticks": str(int(duration) * int(time_base.numerator)), "timescale": int(time_base.denominator)}


def probe(path):
    container = av.open(path)
    try:
        info = {
            "formatName": container.format.name,
            "formatLongName": container.format.long_name,
            # AV_TIME_BASE: microseconds.
            "containerDuration": {"ticks": str(int(container.duration)), "timescale": 1000000} if container.duration is not None else None,
            "containerBitRate": int(container.bit_rate) if container.bit_rate else None,
            "tags": {str(k): str(v)[:400] for k, v in container.metadata.items()},
            "video": None,
            "audio": [],
            "other": [],
        }
        for stream in container.streams:
            if stream.type == "video" and info["video"] is None:
                ctx = stream.codec_context
                tags = {str(k): str(v) for k, v in stream.metadata.items()}
                rotation = None
                if "rotate" in tags:
                    try:
                        rotation = float(tags["rotate"])
                    except ValueError:
                        rotation = None
                sar = stream.sample_aspect_ratio
                dar = stream.display_aspect_ratio
                info["video"] = {
                    "index": stream.index,
                    "codec": ctx.name,
                    "profile": ctx.profile,
                    "level": getattr(ctx, "level", None),
                    "width": ctx.width,
                    "height": ctx.height,
                    "sampleAspectRatio": f"{sar.numerator}:{sar.denominator}" if sar else None,
                    "displayAspectRatio": f"{dar.numerator}:{dar.denominator}" if dar else None,
                    "pixelFormat": ctx.pix_fmt,
                    "bitDepth": getattr(ctx, "bits_per_raw_sample", None) or None,
                    "colorRange": _named(COLOR_RANGE, getattr(ctx, "color_range", None)),
                    "colorPrimaries": _named(COLOR_PRIMARIES, getattr(ctx, "color_primaries", None)),
                    "colorTransfer": _named(COLOR_TRC, getattr(ctx, "color_trc", None)),
                    "colorSpace": _named(COLOR_SPACE, getattr(ctx, "colorspace", None)),
                    "timebase": {"num": int(stream.time_base.numerator), "den": int(stream.time_base.denominator)},
                    "averageFrameRate": _fraction(stream.average_rate),
                    "baseFrameRate": _fraction(stream.base_rate),
                    "startPts": str(int(stream.start_time)) if stream.start_time is not None else None,
                    "declaredFrameCount": int(stream.frames) if stream.frames else None,
                    "declaredDuration": _rational_duration(stream.duration, stream.time_base),
                    "bitRate": int(stream.bit_rate) if stream.bit_rate else None,
                    "rotationDegrees": rotation,
                    "tags": tags,
                }
            elif stream.type == "audio":
                ctx = stream.codec_context
                info["audio"].append({
                    "index": stream.index,
                    "codec": ctx.name,
                    "profile": ctx.profile,
                    "sampleRate": int(ctx.sample_rate),
                    "channels": int(ctx.channels) if hasattr(ctx, "channels") else len(ctx.layout.channels),
                    "channelLayout": ctx.layout.name if ctx.layout else None,
                    "sampleFormat": ctx.format.name if ctx.format else None,
                    "timebase": {"num": int(stream.time_base.numerator), "den": int(stream.time_base.denominator)},
                    "startPts": str(int(stream.start_time)) if stream.start_time is not None else None,
                    "declaredDuration": _rational_duration(stream.duration, stream.time_base),
                    "bitRate": int(stream.bit_rate) if stream.bit_rate else None,
                })
            else:
                codec = None
                try:
                    codec = stream.codec_context.name
                except Exception:  # noqa: BLE001 - a data stream may have no codec context at all
                    codec = None
                info["other"].append({"index": stream.index, "kind": stream.type, "codec": codec})
        return info
    finally:
        container.close()


def main(argv=None):
    """python3 -m actone_forensics.probe FILM — the container's own account of the file, as JSON."""
    import json
    import sys

    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        raise SystemExit("usage: python3 -m actone_forensics.probe FILM")
    print(json.dumps(probe(args[0])))


if __name__ == "__main__":
    main()
