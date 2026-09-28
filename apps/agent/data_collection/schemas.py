"""Structured response contract for the collection agent."""

from __future__ import annotations

from pydantic import BaseModel, Field


class CollectedDataset(BaseModel):
    """One collected dataset row: clean, fixed fields."""

    description: str = Field(description="What was asked, e.g. NIFTY 1day Sep 15-22")
    dataset_id: str = Field(description="Deterministic SHA-256 id from the tool")
    status: str = Field(description="COMPLETE, PARTIAL or FAILED")
    record_count: int = Field(description="Stored candle rows")
    verdict: str = Field(default="", description="VALID/INVALID/INCOMPLETE or empty")


class CollectionResponse(BaseModel):
    """Final JSON contract: datasets + one-line summary, no prose."""

    datasets: list[CollectedDataset] = Field(description="Collected datasets only")
    summary: str = Field(description="One-line completion summary")
