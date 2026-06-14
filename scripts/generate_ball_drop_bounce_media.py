#!/usr/bin/env python3
"""Generate the homepage BallDrop GIF plus video exports.

The animation is intentionally deterministic and minimal: a 1D bouncing ball
on the left and its position-time trace on the right.
"""

from __future__ import annotations

import math
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
MEDIA_DIR = ROOT / "assets" / "media"
GIF_PATH = MEDIA_DIR / "ball-drop-bounce.gif"
MP4_PATH = MEDIA_DIR / "ball-drop-bounce.mp4"
WEBM_PATH = MEDIA_DIR / "ball-drop-bounce.webm"

WIDTH = 800
HEIGHT = 450
FPS = 18
DURATION_SECONDS = 4.0
FRAME_COUNT = int(FPS * DURATION_SECONDS)
INITIAL_HEIGHT = 2.2
RESET_FRAMES = 8

WHITE = (255, 255, 255)
BLACK = (17, 17, 17)
GRAY = (95, 99, 104)
LIGHT_GRAY = (217, 222, 227)
SOFT_GRAY = (238, 241, 244)
BLUE = (31, 95, 191)
ORANGE = (217, 121, 23)


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            pass
    return ImageFont.load_default()


FONT_11 = font(11)
FONT_12 = font(12)
FONT_13 = font(13)


def build_trajectory() -> tuple[list[float], list[float], list[int], float]:
    """Return sampled time, position, bounce-frame indices, and intervention time."""

    g = 9.81
    initial_height = INITIAL_HEIGHT
    t = 0.0
    v = 0.0
    y = initial_height
    dt = 1.0 / FPS
    samples_t: list[float] = []
    samples_y: list[float] = []
    bounce_frames: list[int] = []
    # User-facing bounce coefficient is a rebound-height ratio. Velocity
    # restitution is therefore sqrt(coefficient) for parabolic motion.
    restitution = math.sqrt(0.9)
    bounce_count = 0
    intervention_t: float | None = None

    for frame in range(FRAME_COUNT):
        samples_t.append(frame * dt)
        samples_y.append(max(0.0, y))

        v -= g * dt
        y += v * dt

        if y <= 0.0 and v < 0.0:
            impact_v = abs(v)
            y = 0.0
            bounce_count += 1
            bounce_frames.append(frame)
            if bounce_count == 3:
                intervention_t = frame * dt
                restitution = math.sqrt(0.2)
            v = impact_v * restitution

            if bounce_count >= 4:
                # The post-intervention low bounce has happened; settle cleanly.
                v = 0.0

        if bounce_count >= 4:
            y = 0.0
            v = 0.0

        t += dt

    if intervention_t is None:
        raise RuntimeError("trajectory never reached intervention")

    # Add a quiet reset ramp at the end so the loop returns to the initial state
    # without changing the physical bounce sequence.
    hold_start = FRAME_COUNT - RESET_FRAMES
    for frame in range(hold_start, FRAME_COUNT):
        u = (frame - hold_start + 1) / RESET_FRAMES
        eased = u * u * (3 - 2 * u)
        samples_y[frame] = initial_height * eased

    return samples_t, samples_y, bounce_frames, intervention_t


def map_range(value: float, src_min: float, src_max: float, dst_min: float, dst_max: float) -> float:
    if src_max == src_min:
        return dst_min
    u = (value - src_min) / (src_max - src_min)
    return dst_min + u * (dst_max - dst_min)


def draw_axes(draw: ImageDraw.ImageDraw, origin: tuple[int, int], size: tuple[int, int], x_label: str, y_label: str) -> None:
    x0, y0 = origin
    w, h = size
    draw.line((x0, y0, x0 + w, y0), fill=BLACK, width=1)
    draw.line((x0, y0, x0, y0 - h), fill=BLACK, width=1)
    draw.text((x0 + w - 24, y0 + 12), x_label, fill=GRAY, font=FONT_12)
    draw.text((x0 - 10, y0 - h - 24), y_label, fill=GRAY, font=FONT_12)


def polyline(points: list[tuple[float, float]]) -> list[tuple[int, int]]:
    return [(round(x), round(y)) for x, y in points]


def render_frame(
    frame: int,
    times: list[float],
    positions: list[float],
    bounce_frames: list[int],
    intervention_t: float,
) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), WHITE)
    draw = ImageDraw.Draw(image)

    left_x0, left_x1 = 58, 330
    ground_y = 356
    top_y = 78
    axis_x = 102
    ball_x = 222
    max_height = INITIAL_HEIGHT

    # Left simulator view.
    draw.line((axis_x, ground_y, axis_x, top_y), fill=BLACK, width=1)
    draw.line((left_x0, ground_y, left_x1, ground_y), fill=BLACK, width=1)
    draw.text((left_x0, ground_y + 18), "1D BallDrop simulator", fill=GRAY, font=FONT_12)

    y = positions[frame]
    ball_y = map_range(y, 0.0, max_height, ground_y - 15, top_y + 15)
    radius = 13
    draw.ellipse((ball_x - radius, ball_y - radius, ball_x + radius, ball_y + radius), outline=BLUE, width=2)

    if any(abs(frame - b) <= 1 for b in bounce_frames):
        draw.line((ball_x - 18, ground_y + 4, ball_x + 18, ground_y + 4), fill=LIGHT_GRAY, width=2)

    draw.text((left_x0, 48), "bounce coefficient", fill=GRAY, font=FONT_11)
    current_e = "0.2" if times[frame] >= intervention_t else "0.9"
    draw.text((left_x0, 65), f"e = {current_e}", fill=BLUE if current_e == "0.9" else ORANGE, font=FONT_13)

    # Right time-series plot.
    plot_x0, plot_y0 = 420, 356
    plot_w, plot_h = 312, 278
    draw_axes(draw, (plot_x0, plot_y0), (plot_w, plot_h), "time", "position")

    for i in range(1, 4):
        gy = plot_y0 - i * plot_h / 4
        draw.line((plot_x0, gy, plot_x0 + plot_w, gy), fill=SOFT_GRAY, width=1)

    intervention_x = map_range(intervention_t, 0.0, DURATION_SECONDS, plot_x0, plot_x0 + plot_w)
    draw.line((intervention_x, plot_y0, intervention_x, plot_y0 - plot_h), fill=ORANGE, width=1)
    draw.text((intervention_x + 5, plot_y0 - plot_h + 6), "intervention", fill=GRAY, font=FONT_11)
    draw.text((intervention_x + 5, plot_y0 - plot_h + 21), "e: 0.9 -> 0.2", fill=GRAY, font=FONT_11)

    reset_start = FRAME_COUNT - RESET_FRAMES
    if frame >= reset_start:
        # During the reset, clear the trace back toward the opening state so
        # the GIF loop is visually quiet instead of ending on a synthetic jump.
        end = max(1, int((1 - (frame - reset_start + 1) / RESET_FRAMES) * reset_start))
    else:
        end = min(frame + 1, len(times))
    points = []
    for t, p in zip(times[:end], positions[:end], strict=False):
        px = map_range(t, 0.0, DURATION_SECONDS, plot_x0, plot_x0 + plot_w)
        py = map_range(p, 0.0, max_height, plot_y0, plot_y0 - plot_h)
        points.append((px, py))
    if len(points) > 1:
        draw.line(polyline(points), fill=BLUE, width=2)
    if points:
        px, py = points[-1]
        draw.ellipse((px - 3, py - 3, px + 3, py + 3), fill=BLUE)

    draw.text((58, 405), "three high-restitution bounces, then intervention lowers rebound", fill=GRAY, font=FONT_12)
    return image


def save_gif(frames: list[Image.Image]) -> None:
    # Adaptive palette keeps the file compact while preserving clean linework.
    paletted = [
        frame.quantize(colors=64, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        for frame in frames
    ]
    paletted[0].save(
        GIF_PATH,
        save_all=True,
        append_images=paletted[1:],
        duration=round(1000 / FPS),
        loop=0,
        optimize=True,
        disposal=2,
    )


def run_ffmpeg(args: list[str]) -> None:
    subprocess.run(args, check=True)


def save_video_exports(frames: list[Image.Image]) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        print("ffmpeg not found; skipping MP4/WebM exports")
        return

    with tempfile.TemporaryDirectory(prefix="ball-drop-frames-") as tmp:
        frame_dir = Path(tmp)
        for index, frame in enumerate(frames):
            frame.save(frame_dir / f"frame_{index:04d}.png")

        pattern = str(frame_dir / "frame_%04d.png")
        run_ffmpeg([
            ffmpeg, "-y", "-framerate", str(FPS), "-i", pattern,
            "-vf", "format=yuv420p", "-movflags", "+faststart",
            "-c:v", "libx264", "-crf", "28", str(MP4_PATH),
        ])
        run_ffmpeg([
            ffmpeg, "-y", "-framerate", str(FPS), "-i", pattern,
            "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "38",
            "-pix_fmt", "yuv420p", str(WEBM_PATH),
        ])


def main() -> None:
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    times, positions, bounce_frames, intervention_t = build_trajectory()
    frames = [render_frame(i, times, positions, bounce_frames, intervention_t) for i in range(FRAME_COUNT)]
    save_gif(frames)
    save_video_exports(frames)

    for path in (GIF_PATH, MP4_PATH, WEBM_PATH):
        if path.exists():
            print(f"{path.relative_to(ROOT)} {path.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
