"""Panel joins (option + spot + futures + VIX). STUB — not built yet.

Joining requires futures and VIX datasets, which do not exist in the
tradx DB today. Every entry point raises MissingDataError until the
acquisition task delivers them. This module exists so callers fail
with a clear error instead of silently joining the wrong legs.
"""

from __future__ import annotations

import pandas as pd

from .errors import MissingDataError


def join_snapshots(
    option: pd.DataFrame,
    spot: pd.DataFrame,
    futures: pd.DataFrame | None = None,
    vix: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Join legs on a common decision_ts grid. Currently always raises."""
    missing = []
    if futures is None:
        missing.append("futures dataset")
    if vix is None:
        missing.append("VIX dataset")
    raise MissingDataError(
        "panel join blocked: missing " + ", ".join(missing) + ";"
        " acquire them first (separate task)"
    )


def load_manifest(path: str) -> pd.DataFrame:
    """Validate the contract manifest schema. Currently always raises."""
    raise MissingDataError(
        f"contract manifest not found at {path};"
        " the manifest producer is a separate task"
    )
