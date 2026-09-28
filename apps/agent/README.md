# tradex-agent

Python agent project: `data_collection` agent (deepagents) plus the minimal
base. Scope: collect + validate + store market data only.

## Setup (Windows)

```powershell
cd apps/agent
uv sync
```

## Setup (Linux)

```bash
cd apps/agent
uv sync
```

## Verify

```bash
uv run pytest
uv run ruff check .
uv run mypy data_collection settings.py
```

Deps: `deepagents`, `pydantic`, `pydantic-settings`, `python-dotenv`
(+ `pytest`, `ruff`, `mypy` for dev). Filesystem tools are denied at
build time (`FILESYSTEM_DENY_ALL`) — the agent works through API tools only.
