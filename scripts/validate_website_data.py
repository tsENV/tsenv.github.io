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
    for simulator in simulators:
        env_dir = data_dir / "environments" / str(simulator)
        description = read_json(env_dir / "description.json")
        require(isinstance(description, dict), f"{simulator}/description.json must be an object")
        require(description.get("name"), f"{simulator}/description.json missing name")
        require(description.get("short_one_line_description"), f"{simulator}/description.json missing short description")
        sample_count = int(description.get("sample_count") or 5)
        require(sample_count >= 1, f"{simulator} sample_count must be positive")
        for sample_number in range(1, min(sample_count, 5) + 1):
            sample = read_json(env_dir / f"data_{sample_number}.json")
            require(isinstance(sample.get("rows"), list), f"{simulator}/data_{sample_number}.json must include rows")
            require(sample.get("intervention_time") is not None, f"{simulator}/data_{sample_number}.json missing intervention_time")


def validate(data_dir: Path = DATA) -> None:
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
