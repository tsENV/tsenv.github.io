#!/usr/bin/env python3
"""Deterministic 1D BallDrop animation and synchronized position-time trace.

Outputs:
  ball-drop-bounce.gif
  ball-drop-bounce.mp4
  ball-drop-bounce.webm

The plotted trace endpoint and the simulator ball position are generated from the
same analytic trajectory at each animation frame.  The bounce coefficient `e`
below is a bounce-height coefficient: each rebound peak height is e times the
previous peak height.
"""

from __future__ import annotations

import math
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np
from PIL import Image, ImageDraw, ImageFont

# -----------------------------------------------------------------------------
# Output and animation constants
# -----------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "media"
GIF_NAME = OUT_DIR / "ball-drop-bounce.gif"
MP4_NAME = OUT_DIR / "ball-drop-bounce.mp4"
WEBM_NAME = OUT_DIR / "ball-drop-bounce.webm"

BASE_WIDTH, BASE_HEIGHT = 800, 450
OUTPUT_SCALE = 4
WIDTH, HEIGHT = BASE_WIDTH * OUTPUT_SCALE, BASE_HEIGHT * OUTPUT_SCALE
DURATION_S = 4.0
FPS = 25
N_FRAMES = int(DURATION_S * FPS)
FRAME_TIMES = np.arange(N_FRAMES, dtype=float) / FPS

# Coordinates are authored in the 800x450 base canvas and rendered at 4x.
AA_SCALE = OUTPUT_SCALE

# -----------------------------------------------------------------------------
# Physics constants in normalized position units
# -----------------------------------------------------------------------------
G = 13.5
INITIAL_HEIGHT = 1.0
Y_MAX = 1.05
PRE_INTERVENTION_E = 0.9      # bounce-height coefficient for the first 3 rebounds
POST_INTERVENTION_E = 0.2     # bounce-height coefficient after intervention
NEGLIGIBLE_HEIGHT = 0.005 * Y_MAX

# -----------------------------------------------------------------------------
# Minimal color palette
# -----------------------------------------------------------------------------
WHITE = (255, 255, 255)
BLACK = (20, 20, 20)
GRAY = (110, 110, 110)
LIGHT_GRAY = (218, 218, 218)
BLUE = (31, 119, 180)
ORANGE = (217, 95, 2)


@dataclass(frozen=True)
class Segment:
    kind: str
    start: float
    end: float
    peak: float


def build_trajectory_segments() -> tuple[list[Segment], float, float]:
    """Build deterministic ballistic segments.

    The initial segment is a drop from rest.  The next three rebounds use
    e = 0.9 as a height multiplier.  The intervention time is placed at the
    ground impact immediately after that third e = 0.9 rebound.  Subsequent
    rebounds use e = 0.2 until the next peak would be visually negligible.
    """
    segments: list[Segment] = []
    t = 0.0

    # Initial drop from rest at INITIAL_HEIGHT.
    fall_time = math.sqrt(2.0 * INITIAL_HEIGHT / G)
    segments.append(Segment("drop", t, t + fall_time, INITIAL_HEIGHT))
    t += fall_time

    previous_peak = INITIAL_HEIGHT

    # Three pre-intervention rebounds, with peak heights 90% of the previous.
    for _ in range(3):
        peak = PRE_INTERVENTION_E * previous_peak
        bounce_time = 2.0 * math.sqrt(2.0 * peak / G)
        segments.append(Segment("bounce", t, t + bounce_time, peak))
        t += bounce_time
        previous_peak = peak

    intervention_time = t

    # Repeated post-intervention rebounds with e = 0.2.
    while POST_INTERVENTION_E * previous_peak >= NEGLIGIBLE_HEIGHT:
        peak = POST_INTERVENTION_E * previous_peak
        bounce_time = 2.0 * math.sqrt(2.0 * peak / G)
        segments.append(Segment("bounce", t, t + bounce_time, peak))
        t += bounce_time
        previous_peak = peak

    rest_start_time = t
    return segments, intervention_time, rest_start_time


SEGMENTS, INTERVENTION_TIME, REST_START_TIME = build_trajectory_segments()


def position_at(t: float | np.ndarray) -> float | np.ndarray:
    """Return vertical position above the ground for scalar or array time t."""
    scalar_input = np.isscalar(t)
    t_arr = np.asarray(t, dtype=float)
    y = np.zeros_like(t_arr, dtype=float)

    for seg in SEGMENTS:
        mask = (t_arr >= seg.start) & (t_arr < seg.end)
        if not np.any(mask):
            continue
        tau = t_arr[mask] - seg.start
        if seg.kind == "drop":
            y[mask] = seg.peak - 0.5 * G * tau * tau
        else:
            duration = seg.end - seg.start
            y[mask] = seg.peak - 0.5 * G * (tau - 0.5 * duration) ** 2

    # Clamp tiny numerical roundoff at impacts.
    y = np.clip(y, 0.0, None)
    if scalar_input:
        return float(y)
    return y


# Dense, deterministic trace source. Segment boundaries are included so the
# curve hits impacts exactly, while each frame also appends its exact endpoint.
TRACE_TIMES_BASE = np.unique(
    np.concatenate(
        [
            np.arange(0.0, DURATION_S + 1.0 / 400.0, 1.0 / 400.0),
            np.array([s.start for s in SEGMENTS] + [s.end for s in SEGMENTS] + [DURATION_S]),
        ]
    )
)
TRACE_TIMES_BASE = TRACE_TIMES_BASE[(TRACE_TIMES_BASE >= 0.0) & (TRACE_TIMES_BASE <= DURATION_S)]


# -----------------------------------------------------------------------------
# Drawing helpers
# -----------------------------------------------------------------------------

def scaled_image() -> Image.Image:
    return Image.new("RGB", (BASE_WIDTH * AA_SCALE, BASE_HEIGHT * AA_SCALE), WHITE)


def S(v: float) -> int:
    return int(round(v * AA_SCALE))


def coords(values: Iterable[float]) -> tuple[int, ...]:
    return tuple(S(v) for v in values)


def load_font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype("DejaVuSans.ttf", size * AA_SCALE)
    except OSError:
        return ImageFont.load_default()


FONT_TICK = load_font(10)
FONT_LABEL = load_font(13)
FONT_MARKER = load_font(12)

# Layout: narrow simulator panel at left, wide trace plot at right.
SIM_X0, SIM_X1 = 28, 206
SIM_GROUND_Y = 386
SIM_TOP_Y = 56
BALL_R = 13
BALL_X = 117
DIVIDER_X = 226

PLOT_X0, PLOT_X1 = 288, 766
PLOT_Y0, PLOT_Y1 = 62, 382


def plot_xy(t: np.ndarray | float, y: np.ndarray | float) -> tuple[np.ndarray | float, np.ndarray | float]:
    x_px = PLOT_X0 + (np.asarray(t) / DURATION_S) * (PLOT_X1 - PLOT_X0)
    y_px = PLOT_Y1 - (np.asarray(y) / Y_MAX) * (PLOT_Y1 - PLOT_Y0)
    return x_px, y_px


def sim_y(y: float) -> float:
    usable_height = SIM_GROUND_Y - BALL_R - SIM_TOP_Y
    return SIM_GROUND_Y - BALL_R - (y / Y_MAX) * usable_height


def draw_rotated_text(base: Image.Image, xy: tuple[int, int], text: str, font: ImageFont.ImageFont, fill: tuple[int, int, int]) -> None:
    dummy = Image.new("RGBA", (1, 1), (255, 255, 255, 0))
    dummy_draw = ImageDraw.Draw(dummy)
    bbox = dummy_draw.textbbox((0, 0), text, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    label = Image.new("RGBA", (w + 10 * AA_SCALE, h + 10 * AA_SCALE), (255, 255, 255, 0))
    label_draw = ImageDraw.Draw(label)
    label_draw.text((5 * AA_SCALE - bbox[0], 5 * AA_SCALE - bbox[1]), text, font=font, fill=fill)
    label = label.rotate(90, expand=True)
    base.paste(label, xy, label)


def draw_axes(draw: ImageDraw.ImageDraw, frame: Image.Image) -> None:
    # Axes
    draw.line(coords([PLOT_X0, PLOT_Y1, PLOT_X1, PLOT_Y1]), fill=BLACK, width=S(1.1))
    draw.line(coords([PLOT_X0, PLOT_Y0, PLOT_X0, PLOT_Y1]), fill=BLACK, width=S(1.1))

    # x ticks and labels
    for tick in [0, 1, 2, 3, 4]:
        x, _ = plot_xy(float(tick), 0.0)
        draw.line(coords([x, PLOT_Y1, x, PLOT_Y1 + 5]), fill=BLACK, width=S(0.9))
        label = str(tick)
        bbox = draw.textbbox((0, 0), label, font=FONT_TICK)
        draw.text((S(x) - (bbox[2] - bbox[0]) // 2, S(PLOT_Y1 + 9)), label, fill=GRAY, font=FONT_TICK)

    # y ticks and labels
    for tick, label in [(0.0, "0"), (0.5, "0.5"), (1.0, "1.0")]:
        _, y = plot_xy(0.0, tick)
        draw.line(coords([PLOT_X0 - 5, y, PLOT_X0, y]), fill=BLACK, width=S(0.9))
        bbox = draw.textbbox((0, 0), label, font=FONT_TICK)
        draw.text((S(PLOT_X0 - 9) - (bbox[2] - bbox[0]), S(y) - (bbox[3] - bbox[1]) // 2), label, fill=GRAY, font=FONT_TICK)

    # Axis labels
    x_label = "time"
    bbox = draw.textbbox((0, 0), x_label, font=FONT_LABEL)
    draw.text((S((PLOT_X0 + PLOT_X1) / 2) - (bbox[2] - bbox[0]) // 2, S(421)), x_label, fill=BLACK, font=FONT_LABEL)
    draw_rotated_text(frame, (S(244), S(205)), "position", FONT_LABEL, BLACK)


def draw_simulator(draw: ImageDraw.ImageDraw, current_y: float) -> None:
    # Ground line, no labels.
    draw.line(coords([55, SIM_GROUND_Y, 179, SIM_GROUND_Y]), fill=BLACK, width=S(1.2))

    # Ball is constrained to one horizontal coordinate.
    cy = sim_y(current_y)
    draw.ellipse(coords([BALL_X - BALL_R, cy - BALL_R, BALL_X + BALL_R, cy + BALL_R]), outline=BLUE, width=S(2.1), fill=WHITE)


def draw_intervention_marker(draw: ImageDraw.ImageDraw) -> None:
    x, _ = plot_xy(INTERVENTION_TIME, 0.0)
    draw.line(coords([x, PLOT_Y0, x, PLOT_Y1]), fill=ORANGE, width=S(1.5))
    draw.text((S(x + 8), S(76)), "intervention", fill=ORANGE, font=FONT_MARKER)
    draw.text((S(x + 8), S(92)), "e: 0.9 -> 0.2", fill=ORANGE, font=FONT_MARKER)


def draw_trace(draw: ImageDraw.ImageDraw, current_t: float) -> float:
    visible_t = TRACE_TIMES_BASE[TRACE_TIMES_BASE <= current_t]
    if len(visible_t) == 0 or visible_t[-1] < current_t:
        visible_t = np.append(visible_t, current_t)
    visible_y = position_at(visible_t)
    x, y = plot_xy(visible_t, visible_y)
    points = list(zip([S(v) for v in x], [S(v) for v in y]))
    if len(points) >= 2:
        draw.line(points, fill=BLUE, width=S(1.8), joint="curve")
    elif len(points) == 1:
        px, py = points[0]
        r = S(1.2)
        draw.ellipse((px - r, py - r, px + r, py + r), fill=BLUE)
    return float(visible_y[-1])


def render_frame(current_t: float) -> Image.Image:
    frame = scaled_image()
    draw = ImageDraw.Draw(frame)

    # Panel divider: subtle gray line, no top captions or titles.
    draw.line(coords([DIVIDER_X, 42, DIVIDER_X, 412]), fill=LIGHT_GRAY, width=S(0.9))

    draw_axes(draw, frame)

    if current_t >= INTERVENTION_TIME:
        draw_intervention_marker(draw)

    current_y = draw_trace(draw, current_t)
    draw_simulator(draw, current_y)

    return frame.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)


def generate_frames() -> list[Image.Image]:
    return [render_frame(float(t)) for t in FRAME_TIMES]


def save_gif(frames: Sequence[Image.Image]) -> None:
    # Adaptive palette plus frame-layer optimization keeps the 800x450 GIF small.
    # The ImageMagick pass is deterministic and preserves the loop and 40 ms frame delay.
    paletted = [frame.convert("P", palette=Image.Palette.ADAPTIVE, colors=96) for frame in frames]
    temp_gif = GIF_NAME.with_name(GIF_NAME.stem + "-unoptimized.gif")
    paletted[0].save(
        temp_gif,
        save_all=True,
        append_images=paletted[1:],
        duration=int(1000 / FPS),
        loop=0,
        optimize=True,
        disposal=2,
    )

    magick = shutil.which("magick")
    if magick:
        subprocess.run([magick, str(temp_gif), "-layers", "Optimize", str(GIF_NAME)], check=True)
        temp_gif.unlink(missing_ok=True)
    else:
        temp_gif.replace(GIF_NAME)


def encode_video(frames: Sequence[Image.Image], output: Path, codec_args: Sequence[str]) -> None:
    cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "rawvideo",
        "-vcodec",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s",
        f"{WIDTH}x{HEIGHT}",
        "-r",
        str(FPS),
        "-i",
        "-",
        "-an",
        *codec_args,
        str(output),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    assert proc.stdin is not None
    for frame in frames:
        proc.stdin.write(frame.convert("RGB").tobytes())
    proc.stdin.close()
    return_code = proc.wait()
    if return_code != 0:
        raise RuntimeError(f"ffmpeg failed while writing {output}")


def save_videos(frames: Sequence[Image.Image]) -> None:
    encode_video(
        frames,
        MP4_NAME,
        [
            "-c:v",
            "libx264",
            "-profile:v",
            "main",
            "-preset",
            "slow",
            "-crf",
            "24",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
        ],
    )
    encode_video(
        frames,
        WEBM_NAME,
        [
            "-c:v",
            "libvpx-vp9",
            "-b:v",
            "0",
            "-crf",
            "42",
            "-pix_fmt",
            "yuv420p",
            "-row-mt",
            "1",
        ],
    )


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    frames = generate_frames()
    save_gif(frames)
    save_videos(frames)

    print(f"intervention_time = {INTERVENTION_TIME:.6f} s")
    print(f"rest_start_time    = {REST_START_TIME:.6f} s")
    print(f"rest_duration      = {DURATION_S - REST_START_TIME:.6f} s")
    for path in [GIF_NAME, MP4_NAME, WEBM_NAME]:
        print(f"{path.name}: {os.path.getsize(path) / 1024:.1f} KiB")


if __name__ == "__main__":
    main()
