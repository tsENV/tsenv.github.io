#!/usr/bin/env python3
"""Validate browser-ready TSENV website data."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"
REQUIRED_SEEDS = [0, 1, 2, 3, 4]
REQUIRED_SIMULATORS = ["BallDrop", "BounceBall", "MassSlide"]


class ValidationError(Exception):
    pass


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValidationError(f"missing required file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValidationError(f"invalid JSON in {path}: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


def validate_leaderboard(data_dir: Path) -> None:
    leaderboard = read_json(data_dir / "leaderboard.json")
    require(isinstance(leaderboard, dict), "leaderboard.json must be an object")

    if isinstance(leaderboard.get("rows"), list):
        rows = leaderboard["rows"]
        require("filters" in leaderboard, "leaderboard.json with rows must include filters")
        for row in rows:
            require(isinstance(row, dict), "leaderboard rows must be objects")
            for key in ("rank", "submission_id", "agent", "model", "score", "date", "submitter", "scope"):
                require(key in row, f"leaderboard row missing {key}")
            require(row.get("complete") is not False, f"leaderboard row {row.get('submission_id')} is incomplete")
        return

    conditions = leaderboard.get("conditions")
    require(isinstance(conditions, list), "leaderboard.json must include rows or conditions")
    grid = leaderboard.get("grid")
    require(isinstance(grid, dict), "leaderboard.grid must be an object")
    require(grid.get("requiredSeeds") == REQUIRED_SEEDS, "leaderboard.grid.requiredSeeds must be [0, 1, 2, 3, 4]")
    for row in conditions:
        require(isinstance(row, dict), "condition records must be objects")
        require(row.get("score") is not None, f"condition record {row.get('id')} has no score")
        if "seedIds" in row:
            require(row["seedIds"] == REQUIRED_SEEDS, f"condition record {row.get('id')} must list seeds {REQUIRED_SEEDS}")


def validate_environments(data_dir: Path, summary: dict[str, Any]) -> None:
    simulators = summary.get("simulators") or ["BallDrop", "BounceBall", "MassSlide"]
    require(isinstance(simulators, list) and simulators, "summary.json must include simulators")
    require(simulators == REQUIRED_SIMULATORS, "summary.json simulators must match the public TSENV simulators")
    for simulator in simulators:
        env_dir = data_dir / "environments" / str(simulator)
        description = read_json(env_dir / "description.json")
        require(isinstance(description, dict), f"{simulator}/description.json must be an object")
        require(description.get("name"), f"{simulator}/description.json missing name")
        require(description.get("short_one_line_description"), f"{simulator}/description.json missing short description")
        expected_download_link = (
            "https://huggingface.co/datasets/TommasoBendinelli/tsenv-benchmark/tree/main/questions/"
            f"{simulator}"
        )
        require(
            description.get("download_link") == expected_download_link,
            f"{simulator}/description.json download_link must point to the Hugging Face question directory",
        )
        sample_count = int(description.get("sample_count") or 5)
        require(sample_count >= 1, f"{simulator} sample_count must be positive")
        for sample_number in range(1, min(sample_count, 5) + 1):
            sample = read_json(env_dir / f"data_{sample_number}.json")
            require(isinstance(sample.get("rows"), list), f"{simulator}/data_{sample_number}.json must include rows")
            require(sample.get("intervention_time") is not None, f"{simulator}/data_{sample_number}.json missing intervention_time")
        expected_files = {"description.json"} | {f"data_{sample_number}.json" for sample_number in range(1, 6)}
        actual_files = {path.name for path in env_dir.glob("*.json")}
        require(actual_files == expected_files, f"{simulator} environment directory must contain only description.json and data_1.json through data_5.json")


def validate_site_metadata(root: Path = ROOT) -> None:
    site = read_json(root / "site.json")
    require(isinstance(site, dict), "site.json must be an object")
    for key in ("website_url", "code_url", "hf_repo", "hf_dataset_url", "issues_url", "affiliation_url", "paper_url", "authors", "contact", "citation"):
        require(key in site, f"site.json missing {key}")
    require(isinstance(site["authors"], list) and site["authors"], "site.json authors must be a non-empty list")
    for author in site["authors"]:
        require(isinstance(author, dict), "site.json author entries must be objects")
        require(author.get("name"), "site.json author missing name")
        require("affiliation" in author, "site.json author missing affiliation")
    require(isinstance(site["contact"], dict), "site.json contact must be an object")
    require(site["contact"].get("label"), "site.json contact missing label")
    require(site["contact"].get("url"), "site.json contact missing url")
    require(isinstance(site["citation"], str) and site["citation"].strip(), "site.json citation must be a non-empty string")


def validate(data_dir: Path = DATA) -> None:
    validate_site_metadata()
    summary = read_json(data_dir / "summary.json")
    require(isinstance(summary, dict), "summary.json must be an object")
    canonical = summary.get("canonical_scope")
    require(isinstance(canonical, dict), "summary.json must include canonical_scope")
    for key in ("task_mode", "noise", "context", "examples"):
        require(key in canonical, f"canonical_scope missing {key}")

    validate_leaderboard(data_dir)
    validate_environments(data_dir, summary)


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate generated TSENV website JSON data.")
    parser.add_argument("--data-dir", type=Path, default=DATA)
    args = parser.parse_args()
    try:
        validate(args.data_dir)
    except ValidationError as exc:
        raise SystemExit(f"Website data validation failed: {exc}") from exc
    print(f"Validated TSENV website data in {args.data_dir}")


if __name__ == "__main__":
    main()
