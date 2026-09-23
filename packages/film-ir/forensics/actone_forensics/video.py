"""
One pass over every decoded frame.

For each frame, in presentation order: its timestamp and duration exactly as
the stream carries them, a hash of its decoded pixels at native resolution,
and a set of measurements at a working resolution. Motion is measured twice,
for two different questions: sparse tracked corners with a robust homography
answer "how did the whole picture move" (the apparent camera), and dense flow
answers "how much moved, and did it move as one" (local motion, layers).

Text is read on a stride during the same pass, so the file is decoded once for
everything except the per-frame text refinement that follows.
"""
import hashlib
import math

import av
import cv2
import numpy as np

from .common import emit, hex_from_rgb

WORK_WIDTH = 480
FLOW_WIDTH = 320
COLOUR_WIDTH = 160
SALIENCY_SIZE = 64
OCR_WIDTH = 1280
DOMINANT_K = 5
GRID_COLS, GRID_ROWS = 8, 6
PICT = {1: "I", 2: "P", 3: "B", 4: "S", 5: "SI", 6: "SP", 7: "BI"}

# sRGB decode, once: 8-bit code value to linear light.
_SRGB_TO_LINEAR = np.array(
    [(c / 255.0) / 12.92 if c / 255.0 <= 0.04045 else ((c / 255.0 + 0.055) / 1.055) ** 2.4 for c in range(256)],
    dtype=np.float32,
)
# Björn Ottosson's Oklab, from linear sRGB.
_M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929],
                [0.2119034982, 0.6806995451, 0.1073969566],
                [0.0883024619, 0.2817188376, 0.6299787005]], dtype=np.float32)
_M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468],
                [1.9779984951, -2.4285922050, 0.4505937099],
                [0.0259040371, 0.7827717662, -0.8086757660]], dtype=np.float32)
_M1_INV = np.linalg.inv(_M1.astype(np.float64)).astype(np.float32)
_M2_INV = np.linalg.inv(_M2.astype(np.float64)).astype(np.float32)


def oklab_from_bgr(bgr):
    rgb = bgr[..., ::-1]
    linear = _SRGB_TO_LINEAR[rgb].reshape(-1, 3)
    lms = np.cbrt(linear @ _M1.T)
    return (lms @ _M2.T).astype(np.float32)


def rgb_from_oklab(lab):
    lms = (np.asarray(lab, dtype=np.float32) @ _M2_INV.T) ** 3
    linear = np.clip(lms @ _M1_INV.T, 0, 1)
    encoded = np.where(linear <= 0.0031308, linear * 12.92, 1.055 * np.power(linear, 1 / 2.4) - 0.055)
    return np.clip(encoded * 255, 0, 255)


def _size_for(width, height, target):
    scale = target / float(width)
    return target, max(2, int(round(height * scale / 2)) * 2)


def spectral_residual_saliency(grey_small):
    """Hou & Zhang (2007): the part of the log spectrum that is not the expected 1/f."""
    image = grey_small.astype(np.float32)
    spectrum = np.fft.fft2(image)
    amplitude = np.log(np.abs(spectrum) + 1e-8)
    phase = np.angle(spectrum)
    residual = amplitude - cv2.blur(amplitude, (3, 3))
    saliency = np.abs(np.fft.ifft2(np.exp(residual + 1j * phase))) ** 2
    saliency = cv2.GaussianBlur(saliency.astype(np.float32), (0, 0), 2.5)
    total = float(saliency.sum())
    if total <= 0:
        return None
    return saliency / total


class Decoder:
    """Frames in presentation order, converted as their tags say, or as HD is by default when they say nothing."""

    def __init__(self, path):
        self.container = av.open(path)
        self.stream = self.container.streams.video[0]
        self.stream.thread_type = "AUTO"
        ctx = self.stream.codec_context
        self.width, self.height = ctx.width, ctx.height
        tagged = getattr(ctx, "colorspace", 2)
        self.assumed_matrix = None
        self.reformat_args = {}
        if tagged in (None, 2, 0) and self.height >= 720:
            # Untagged HD: swscale would assume BT.601 and every colour would
            # be off by up to ten code values. BT.709 is the standard for HD,
            # and the assumption is recorded rather than hidden.
            from av.video.reformatter import Colorspace
            self.reformat_args = {"src_colorspace": Colorspace.ITU709}
            self.assumed_matrix = "bt709 (untagged HD)"

    def frames(self):
        for frame in self.container.decode(self.stream):
            yield frame

    def bgr(self, frame, width, height):
        return frame.reformat(width=width, height=height, format="bgr24", interpolation="AREA", **self.reformat_args).to_ndarray()

    def close(self):
        self.container.close()


def global_motion(prev_grey, grey, width, height):
    """
    How the whole picture moved between two frames, as a homography fitted
    by RANSAC to corners tracked forward and back. Only corners that survive
    the round trip within a pixel are trusted.
    """
    corners = cv2.goodFeaturesToTrack(prev_grey, maxCorners=500, qualityLevel=0.01, minDistance=7, blockSize=7)
    result = {"detected": 0 if corners is None else int(len(corners)), "tracked": 0, "valid": False}
    if corners is None or len(corners) < 8:
        return result
    criteria = (cv2.TERM_CRITERIA_COUNT | cv2.TERM_CRITERIA_EPS, 30, 0.01)
    forward, status, _ = cv2.calcOpticalFlowPyrLK(prev_grey, grey, corners, None, winSize=(21, 21), maxLevel=3, criteria=criteria)
    back, status_back, _ = cv2.calcOpticalFlowPyrLK(grey, prev_grey, forward, None, winSize=(21, 21), maxLevel=3, criteria=criteria)
    good = (status.ravel() == 1) & (status_back.ravel() == 1) & (np.linalg.norm((back - corners).reshape(-1, 2), axis=1) < 1.0)
    src = corners.reshape(-1, 2)[good]
    dst = forward.reshape(-1, 2)[good]
    result["tracked"] = int(len(src))
    if len(src) < 8:
        return result
    cv2.setRNGSeed(0)
    homography, mask = cv2.findHomography(src, dst, cv2.RANSAC, 1.5, maxIters=2000, confidence=0.995)
    if homography is None or abs(homography[2, 2]) < 1e-9:
        return result
    homography = homography / homography[2, 2]
    inliers = mask.ravel().astype(bool)
    if inliers.sum() < 8:
        return result
    centre = np.array([[[width / 2.0, height / 2.0]]], dtype=np.float64)
    moved = cv2.perspectiveTransform(centre, homography)[0, 0]
    a, b, c, d = homography[0, 0], homography[0, 1], homography[1, 0], homography[1, 1]
    projected = cv2.perspectiveTransform(src[inliers].reshape(-1, 1, 2).astype(np.float64), homography).reshape(-1, 2)
    residual = float(np.median(np.linalg.norm(projected - dst[inliers], axis=1)))
    cells = set()
    for x, y in src[inliers]:
        cells.add((min(GRID_COLS - 1, int(x / width * GRID_COLS)), min(GRID_ROWS - 1, int(y / height * GRID_ROWS))))
    result.update({
        "valid": True,
        "tx": float(moved[0] - width / 2.0),
        "ty": float(moved[1] - height / 2.0),
        "scale": float(math.sqrt(abs(a * d - b * c))),
        "rotation": float(math.degrees(math.atan2(c - b, a + d))),
        "px": float(homography[2, 0] * width),
        "py": float(homography[2, 1] * height),
        "inliers": int(inliers.sum()),
        "coverage": len(cells) / float(GRID_COLS * GRID_ROWS),
        "residual": residual,
        "h": homography,
    })
    return result


def flow_measures(prev_small, small, homography_work, work_to_flow):
    """Dense flow: how much moved, how much of it the global model explains, and whether it moved in layers."""
    dis = flow_measures.dis
    if dis is None:
        dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_FAST)
        flow_measures.dis = dis
    flow = dis.calc(prev_small, small, None)
    h, w = small.shape
    magnitude = np.linalg.norm(flow, axis=2)
    out = {
        "flowMean": float(magnitude.mean()) / w,
        "flowP90": float(np.percentile(magnitude, 90)) / w,
        "localMotion": None,
        "layerSpeedRatio": None,
    }
    if homography_work is not None:
        scale = np.diag([work_to_flow, work_to_flow, 1.0])
        homography = scale @ homography_work @ np.linalg.inv(scale)
        ys, xs = np.mgrid[0:h:4, 0:w:4].astype(np.float64)
        points = np.stack([xs.ravel(), ys.ravel()], axis=1).reshape(-1, 1, 2)
        predicted = cv2.perspectiveTransform(points, homography).reshape(-1, 2) - points.reshape(-1, 2)
        observed = flow[0:h:4, 0:w:4].reshape(-1, 2)
        residual = np.linalg.norm(observed - predicted, axis=1)
        out["localMotion"] = float(residual.mean()) / w
    moving = magnitude[0:h:2, 0:w:2].ravel() > 0.5
    vectors = flow[0:h:2, 0:w:2].reshape(-1, 2)[moving]
    if len(vectors) >= 200:
        sample = vectors[:: max(1, len(vectors) // 2000)].astype(np.float32)
        cv2.setRNGSeed(0)
        _, labels, centres = cv2.kmeans(sample, 2, None, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_MAX_ITER, 20, 0.05), 1, cv2.KMEANS_PP_CENTERS)
        shares = np.bincount(labels.ravel(), minlength=2) / float(len(labels))
        speeds = np.linalg.norm(centres, axis=1)
        if shares.min() >= 0.1 and speeds.min() > 0.05:
            out["layerSpeedRatio"] = float(speeds.max() / speeds.min())
        elif shares.min() >= 0.1:
            out["layerSpeedRatio"] = None
        else:
            out["layerSpeedRatio"] = 1.0
    return out


flow_measures.dis = None


def colour_measures(bgr_small):
    lab = oklab_from_bgr(bgr_small)
    chroma = np.sqrt(lab[:, 1] ** 2 + lab[:, 2] ** 2)
    hue = (np.degrees(np.arctan2(lab[:, 2], lab[:, 1])) + 360.0) % 360.0
    weights = np.where(chroma > 0.02, chroma, 0.0)
    histogram = np.bincount(np.minimum(11, (hue / 30.0).astype(int)), weights=weights, minlength=12)
    total = histogram.sum()
    histogram = histogram / total if total > 0 else histogram
    cv2.setRNGSeed(0)
    compactness, labels, centres = cv2.kmeans(
        lab.astype(np.float32), DOMINANT_K, None,
        (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_MAX_ITER, 20, 0.002), 1, cv2.KMEANS_PP_CENTERS,
    )
    counts = np.bincount(labels.ravel(), minlength=DOMINANT_K) / float(len(labels))
    order = np.argsort(-counts)
    rgb = rgb_from_oklab(centres[order])
    dominant = [[float(rgb[i, 0]), float(rgb[i, 1]), float(rgb[i, 2]), float(counts[order][i])] for i in range(DOMINANT_K)]
    hsv = cv2.cvtColor(bgr_small, cv2.COLOR_BGR2HSV)
    return {
        "chromaMean": float(chroma.mean()),
        "saturationMean": float(hsv[..., 1].mean() / 255.0),
        "hueHistogram": histogram.tolist(),
        "dominant": dominant,
    }


def border_colour(bgr_small):
    h, w = bgr_small.shape[:2]
    band = max(1, int(round(min(h, w) * 0.06)))
    ring = np.concatenate([
        bgr_small[:band].reshape(-1, 3), bgr_small[-band:].reshape(-1, 3),
        bgr_small[:, :band].reshape(-1, 3), bgr_small[:, -band:].reshape(-1, 3),
    ])
    median = np.median(ring, axis=0)
    return [float(median[2]), float(median[1]), float(median[0])]


def analyze_video(path, ocr=None, ocr_stride=None, progress_every=60):
    decoder = Decoder(path)
    width, height = decoder.width, decoder.height
    work_w, work_h = _size_for(width, height, WORK_WIDTH)
    flow_w, flow_h = _size_for(width, height, FLOW_WIDTH)
    colour_w, colour_h = _size_for(width, height, COLOUR_WIDTH)
    ocr_w, ocr_h = _size_for(width, height, min(OCR_WIDTH, width))
    declared = decoder.stream.frames or 0

    table = {"pts": [], "durations": [], "keyframe": [], "pictureType": [], "hash": [], "repeatOf": []}
    features = {name: [] for name in (
        "luma_mean", "luma_std", "luma_p05", "luma_p50", "luma_p95", "luma_entropy",
        "saturation_mean", "chroma_mean", "sharpness", "edge_density", "spatial_information",
        "temporal_information", "pixel_difference", "histogram_distance", "edge_change_ratio",
        "flow_mean", "flow_p90", "local_motion", "layer_speed_ratio",
        "gm_valid", "gm_tx", "gm_ty", "gm_scale", "gm_rotation", "gm_px", "gm_py",
        "gm_inliers", "gm_coverage", "gm_residual", "gm_tracked_ratio",
        "saliency_x", "saliency_y", "saliency_spread", "border_luma",
    )}
    vectors = {"hue_histogram": [], "dominant_colours": [], "border_rgb": []}
    homographies = []
    small_grey = []
    small_bgr = []
    ocr_frames = []

    prev = None
    last_read = None
    rate = decoder.stream.average_rate
    ocr_refresh = int(round(float(rate))) if rate else 30
    index = 0
    for frame in decoder.frames():
        if frame.pts is None:
            # A frame with no timestamp cannot be placed on the timeline at all.
            raise ValueError(f"frame {index} carries no presentation timestamp")
        table["pts"].append(str(int(frame.pts)))
        table["durations"].append(None if frame.duration in (None, 0) else str(int(frame.duration)))
        table["keyframe"].append(bool(frame.key_frame))
        table["pictureType"].append(PICT.get(int(frame.pict_type), "?") if frame.pict_type is not None else "?")

        native = frame.to_ndarray()
        digest = hashlib.blake2b(native.tobytes(), digest_size=16).hexdigest()
        table["hash"].append(digest)
        table["repeatOf"].append(index - 1 if prev is not None and prev["hash"] == digest else None)

        bgr = decoder.bgr(frame, work_w, work_h)
        grey = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        grey_flow = cv2.resize(grey, (flow_w, flow_h), interpolation=cv2.INTER_AREA)
        bgr_small = cv2.resize(bgr, (colour_w, colour_h), interpolation=cv2.INTER_AREA)
        grey_small = cv2.cvtColor(bgr_small, cv2.COLOR_BGR2GRAY)
        small_grey.append(grey_small)
        small_bgr.append(bgr_small)

        rgbf = bgr[..., ::-1].astype(np.float32)
        luma = (0.2126 * rgbf[..., 0] + 0.7152 * rgbf[..., 1] + 0.0722 * rgbf[..., 2]) / 255.0
        p05, p50, p95 = np.percentile(luma, [5, 50, 95])
        hist = np.bincount(np.minimum(63, (luma * 64).astype(int)).ravel(), minlength=64).astype(np.float64)
        hist /= hist.sum()
        entropy = float(-(hist[hist > 0] * np.log2(hist[hist > 0])).sum())
        features["luma_mean"].append(float(luma.mean()))
        features["luma_std"].append(float(luma.std()))
        features["luma_p05"].append(float(p05))
        features["luma_p50"].append(float(p50))
        features["luma_p95"].append(float(p95))
        features["luma_entropy"].append(entropy)

        colour = colour_measures(bgr_small)
        features["saturation_mean"].append(colour["saturationMean"])
        features["chroma_mean"].append(colour["chromaMean"])
        vectors["hue_histogram"].append(colour["hueHistogram"])
        vectors["dominant_colours"].append(colour["dominant"])
        border = border_colour(bgr_small)
        vectors["border_rgb"].append(border)
        features["border_luma"].append((0.2126 * border[0] + 0.7152 * border[1] + 0.0722 * border[2]) / 255.0)

        features["sharpness"].append(float(cv2.Laplacian(grey, cv2.CV_64F).var()))
        edges = cv2.Canny(grey, 80, 160)
        features["edge_density"].append(float((edges > 0).mean()))
        sobel_x = cv2.Sobel(grey, cv2.CV_32F, 1, 0, ksize=3)
        sobel_y = cv2.Sobel(grey, cv2.CV_32F, 0, 1, ksize=3)
        features["spatial_information"].append(float(np.sqrt(sobel_x ** 2 + sobel_y ** 2).std()))

        hsv_hist = cv2.calcHist([cv2.cvtColor(bgr_small, cv2.COLOR_BGR2HSV)], [0, 1, 2], None, [16, 4, 4], [0, 180, 0, 256, 0, 256])
        cv2.normalize(hsv_hist, hsv_hist, 1.0, 0.0, cv2.NORM_L1)

        saliency = spectral_residual_saliency(cv2.resize(grey, (SALIENCY_SIZE, SALIENCY_SIZE), interpolation=cv2.INTER_AREA))
        if saliency is not None:
            ys, xs = np.mgrid[0:SALIENCY_SIZE, 0:SALIENCY_SIZE].astype(np.float64)
            cx = float((saliency * xs).sum()) / SALIENCY_SIZE
            cy = float((saliency * ys).sum()) / SALIENCY_SIZE
            spread = float(np.sqrt((saliency * ((xs / SALIENCY_SIZE - cx) ** 2 + (ys / SALIENCY_SIZE - cy) ** 2)).sum()))
            features["saliency_x"].append(cx + 0.5 / SALIENCY_SIZE)
            features["saliency_y"].append(cy + 0.5 / SALIENCY_SIZE)
            features["saliency_spread"].append(spread)
        else:
            features["saliency_x"].append(None)
            features["saliency_y"].append(None)
            features["saliency_spread"].append(None)

        if prev is None:
            for name in ("temporal_information", "pixel_difference", "histogram_distance", "edge_change_ratio",
                         "flow_mean", "flow_p90", "local_motion", "layer_speed_ratio", "gm_tx", "gm_ty", "gm_scale",
                         "gm_rotation", "gm_px", "gm_py", "gm_inliers", "gm_coverage", "gm_residual", "gm_tracked_ratio"):
                features[name].append(None)
            features["gm_valid"].append(0)
            homographies.append(None)
        else:
            diff = grey.astype(np.float32) - prev["grey"].astype(np.float32)
            features["temporal_information"].append(float(diff.std()))
            features["pixel_difference"].append(float(np.abs(grey_small.astype(np.float32) - prev["grey_small"].astype(np.float32)).mean() / 255.0))
            features["histogram_distance"].append(float(cv2.compareHist(prev["hsv_hist"], hsv_hist, cv2.HISTCMP_BHATTACHARYYA)))
            features["edge_change_ratio"].append(edge_change_ratio(prev["edges"], edges))
            motion = global_motion(prev["grey"], grey, work_w, work_h)
            detected = max(1, motion["detected"])
            features["gm_tracked_ratio"].append(motion["tracked"] / detected if motion["detected"] else None)
            if motion["valid"]:
                features["gm_valid"].append(1)
                features["gm_tx"].append(motion["tx"] / work_w)
                features["gm_ty"].append(motion["ty"] / work_w)
                features["gm_scale"].append(motion["scale"])
                features["gm_rotation"].append(motion["rotation"])
                features["gm_px"].append(motion["px"])
                features["gm_py"].append(motion["py"])
                features["gm_inliers"].append(motion["inliers"])
                features["gm_coverage"].append(motion["coverage"])
                features["gm_residual"].append(motion["residual"] / work_w)
                homographies.append(motion["h"])
            else:
                features["gm_valid"].append(0)
                for name in ("gm_tx", "gm_ty", "gm_scale", "gm_rotation", "gm_px", "gm_py", "gm_inliers", "gm_coverage", "gm_residual"):
                    features[name].append(None)
                homographies.append(None)
            flow = flow_measures(prev["grey_flow"], grey_flow, homographies[-1], flow_w / float(work_w))
            features["flow_mean"].append(flow["flowMean"])
            features["flow_p90"].append(flow["flowP90"])
            features["local_motion"].append(flow["localMotion"])
            features["layer_speed_ratio"].append(flow["layerSpeedRatio"])

        if ocr is not None and ocr_stride and index % ocr_stride == 0:
            # A frame identical to the last one read says the same words; reading
            # it again would only cost time. Held frames are still re-read once a
            # second, so a slow change never goes unread for long.
            unchanged = last_read is not None and index - last_read["frame"] < ocr_refresh and float(
                np.abs(grey_small.astype(np.float32) - last_read["grey"].astype(np.float32)).mean()) / 255.0 < 0.004
            if unchanged:
                ocr_frames.append({"frame": index, "lines": last_read["lines"], "reused": last_read["frame"]})
            else:
                lines = ocr.read(decoder.bgr(frame, ocr_w, ocr_h), scale=width / float(ocr_w))
                ocr_frames.append({"frame": index, "lines": lines})
                last_read = {"frame": index, "grey": grey_small, "lines": lines}

        prev = {"hash": digest, "grey": grey, "grey_flow": grey_flow, "grey_small": grey_small, "hsv_hist": hsv_hist, "edges": edges}
        index += 1
        if index % progress_every == 0:
            emit("video", min(0.99, index / float(declared)) if declared else 0.0, f"{index} frames")

    decoder.close()
    # A stream that leaves the last duration unset: the gap to the next frame is
    # known for every frame but the last, and the last is left unknown rather
    # than guessed.
    for i in range(len(table["durations"]) - 1):
        if table["durations"][i] is None:
            table["durations"][i] = str(int(table["pts"][i + 1]) - int(table["pts"][i]))
    return {
        "width": width,
        "height": height,
        "work": {"width": work_w, "height": work_h},
        "flow": {"width": flow_w, "height": flow_h},
        "colour": {"width": colour_w, "height": colour_h},
        "ocrSize": {"width": ocr_w, "height": ocr_h},
        "assumedMatrix": decoder.assumed_matrix,
        "table": table,
        "features": features,
        "vectors": vectors,
        "homographies": homographies,
        "smallGrey": small_grey,
        "smallBgr": small_bgr,
        "ocrFrames": ocr_frames,
    }


def edge_change_ratio(prev_edges, edges):
    """Zabih, Miller & Mai (1995): the share of edge pixels that entered or left between two frames."""
    kernel = np.ones((5, 5), np.uint8)
    prev_dilated = cv2.dilate(prev_edges, kernel)
    dilated = cv2.dilate(edges, kernel)
    prev_count = max(1, int((prev_edges > 0).sum()))
    count = max(1, int((edges > 0).sum()))
    entering = float(((edges > 0) & (prev_dilated == 0)).sum()) / count
    exiting = float(((prev_edges > 0) & (dilated == 0)).sum()) / prev_count
    return max(entering, exiting)


def dominant_hex(dominant):
    return [{"hex": hex_from_rgb(entry[:3]), "share": entry[3]} for entry in dominant]
