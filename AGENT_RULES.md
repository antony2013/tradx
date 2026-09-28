# Agent Rules

## 1. Package Management
- Never hand-write or hand-edit `package.json`, `pyproject.toml`, `Cargo.toml`, or any dependency manifest.
- Always install packages through the proper package manager command so the lockfile and manifest stay in sync.
- Python projects: use `uv` only (`uv add`, `uv sync`, `uv run`). No `pip install` unless explicitly told otherwise.
- Node projects: use `bun` only (`bun add`, `bun install`, `bun run`). No `npm`/`yarn`/`pnpm` unless explicitly told otherwise.

## 2. No Mock Data
- Never fabricate placeholder/mock data to make a feature "look" done.
- If real data/API/DB isn't available yet, say so and stop — don't paper over it with fake data.

## 3. Clean Project Structure
- Source code and test code live in separate, clearly named directories (e.g. `src/` and `tests/`) — never mixed together.
- No stray scratch files, commented-out dead code, or leftover debug files in the repo.

## 4. Always Check Latest Docs
- Before using any library, framework, or API, look up its current/latest documentation — don't rely on memorized/possibly-outdated knowledge, especially for versions and breaking changes.

## 5. Vertical Slices, Not Big-Bang
- Never try to build the entire project in one shot.
- Break the project into features. Build ONE feature fully (backend + frontend + logic it needs) before starting the next.
- Do not touch unrelated parts of the codebase while working a slice.

## 6. Test-Gate Before Moving On
- Each feature must have its own tests.
- A feature is only "done" when its tests pass.
- Do not start the next feature until the current one's tests are green.

---

### Added by me (not in your original list, flag if you disagree/want removed)
- **No silent scope creep**: if a task looks bigger than what was asked, stop and say so instead of quietly expanding it — given your own noted analysis-paralysis/scope-drift pattern, this is worth enforcing explicitly.
- **No hardcoded secrets/config**: API keys, DB URLs, credentials go through env vars / `.env`, never inline in code.
- **Explain before destructive actions**: `git reset --hard`, force pushes, dropping DB tables, deleting files — state intent and get confirmation first.
- **Commit per feature slice**: one logical commit (or small set) per completed, tested feature — not one giant commit at the end.

If any of these four don't fit how you work, tell me and I'll strip them out.
