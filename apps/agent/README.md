# tradex-agent

Minimal Python base for the future agent. Nothing else installed.

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
```

Base deps only: `pydantic`, `pydantic-settings`, `python-dotenv`
(+ `pytest`, `ruff` for dev). No deepagents, no sandbox — those come
only when explicitly requested.
