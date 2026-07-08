#!/usr/bin/env python3
"""Export an HLE split from Hugging Face datasets to local JSONL.

This tiny helper mirrors the official HLE loading path:

    load_dataset("cais/hle", split="test")

Keeping the adapter's TypeScript runner file-based makes benchmark runs
resumable and avoids adding Hugging Face dependencies to the main MMD app.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from datasets import load_dataset


def json_default(value: Any) -> str:
    return str(value)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default="cais/hle", help="Hugging Face dataset name")
    parser.add_argument("--split", default="test", help="Dataset split to export")
    parser.add_argument("--out", default="data/hle-test.jsonl", help="Output JSONL path")
    parser.add_argument("--max-samples", type=int, default=None, help="Optional row limit")
    args = parser.parse_args()

    dataset = load_dataset(args.dataset, split=args.split)
    if args.max_samples is not None:
        dataset = dataset.select(range(min(args.max_samples, len(dataset))))

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with out_path.open("w", encoding="utf-8") as handle:
        for row in dataset:
            handle.write(json.dumps(row, ensure_ascii=False, default=json_default))
            handle.write("\n")

    print(f"Wrote {len(dataset)} rows to {out_path}")


if __name__ == "__main__":
    main()
