"""Research config. Constants only; DB URLs come from env, never inline."""

from __future__ import annotations

import os
from pathlib import Path

# Constant risk-free rate, source: user (2026-10-03). Never infer it.
RISK_FREE_RATE = 0.053

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(
    os.environ.get("TRADX_RESEARCH_DATA_DIR", PACKAGE_ROOT / "data")
)

REPO_ROOT = PACKAGE_ROOT.parents[1]
TRADX_DB_PATH = os.environ.get(
    "TRADX_DB_PATH",
    str(REPO_ROOT / "apps" / "api" / "data" / "research.db"),
)

EXPECTED_DATASET_SCHEMA_VERSION = "upstox-v3-candles-1"
EXPECTED_VALIDATION_SCHEMA_VERSION = "integrity-report-1"

IST = "Asia/Kolkata"
