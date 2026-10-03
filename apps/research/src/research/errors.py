"""Shared research errors. Missing input always raises, never fabricates."""


class MissingDataError(Exception):
    """A required input (dataset, manifest, leg) does not exist."""


class InvalidDatasetError(Exception):
    """A dataset exists but is unusable (not VALID, bad schema, bad bars)."""
