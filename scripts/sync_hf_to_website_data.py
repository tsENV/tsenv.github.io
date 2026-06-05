#!/usr/bin/env python3
"""Synchronize Hugging Face benchmark JSON into the static website tree."""

from __future__ import annotations

import argparse
import os
import shutil
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote

from validate_website_data import validate


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"
DEFAULT_REPO = "TommasoBendinelli/tsenv-benchmark"
TOP_LEVEL_FILES = ("summary.json", "leaderboard.json")
SIMULATORS = ("BallDrop", "BounceBall", "MassSlide")


def ssl_context() -> ssl.SSLContext | None:
    try:
        import certifi
    except ImportError:
        return None
    return ssl.create_default_context(cafile=certifi.where())


def copy_tree(source: Path, destination: Path) -> None:
    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(source, destination)


def hf_url(repo: str, path: str, revision: str) -> str:
    encoded = "/".join(quote(part) for part in path.split("/"))
    return f"https://huggingface.co/datasets/{repo}/resolve/{quote(revision)}/{encoded}"


def download_file(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    headers = {}
    hf_token = os.environ.get("HF_TOKEN", "").strip()
    if hf_token:
        headers["Authorization"] = f"Bearer {hf_token}"
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30, context=ssl_context()) as response:
            destination.write_bytes(response.read())
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"failed to download {url}: HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"failed to download {url}: {exc.reason}") from exc


def sync_from_hf(repo: str, revision: str, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for filename in TOP_LEVEL_FILES:
        download_file(hf_url(repo, f"website/{filename}", revision), output_dir / filename)
    for simulator in SIMULATORS:
        base = f"website/environments/{simulator}"
        download_file(hf_url(repo, f"{base}/description.json", revision), output_dir / "environments" / simulator / "description.json")
        for sample_number in range(1, 6):
            download_file(hf_url(repo, f"{base}/data_{sample_number}.json", revision), output_dir / "environments" / simulator / f"data_{sample_number}.json")

    submissions_manifest = output_dir / "submissions_manifest.txt"
    try:
        download_file(hf_url(repo, "website/submissions_manifest.txt", revision), submissions_manifest)
    except RuntimeError:
        submissions_manifest.write_text("", encoding="utf-8")

    submissions_dir = output_dir / "submissions"
    if submissions_dir.exists():
        shutil.rmtree(submissions_dir)
    submissions_dir.mkdir(exist_ok=True)
    for line in submissions_manifest.read_text(encoding="utf-8").splitlines():
        submission_id = line.strip()
        if not submission_id:
            continue
        download_file(
            hf_url(repo, f"website/submissions/{submission_id}.json", revision),
            submissions_dir / f"{submission_id}.json",
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync TSENV website data from Hugging Face.")
    parser.add_argument("--hf-repo", default=DEFAULT_REPO)
    parser.add_argument("--revision", default="main")
    parser.add_argument("--output-dir", type=Path, default=DATA)
    parser.add_argument("--source-dir", type=Path, help="Copy browser-ready data from a local directory instead of Hugging Face.")
    parser.add_argument("--validate-only", action="store_true", help="Only validate the output directory.")
    args = parser.parse_args()

    if args.source_dir:
        copy_tree(args.source_dir, args.output_dir)
    elif not args.validate_only:
        sync_from_hf(args.hf_repo, args.revision, args.output_dir)

    try:
        validate(args.output_dir)
    except Exception as exc:  # noqa: BLE001 - CLI should present one concise failure.
        raise SystemExit(str(exc)) from exc
    print(f"Website data ready in {args.output_dir}")


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    main()
