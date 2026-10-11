# Studio platform

[![CI](https://github.com/GalHavshush/studio-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/GalHavshush/studio-platform/actions/workflows/ci.yml)

Multi-tenant platform for small coach-led studios (BJJ, MMA, pilates, yoga, CrossFit, dance).
Core idea: coaches build a shared history of each participant through class reports and notes.

## Layout
- `api/`: FastAPI backend (Python, managed with [uv](https://docs.astral.sh/uv/))
- `app/`: Expo client (placeholder until the frontend milestone)

## Requirements
- [uv](https://docs.astral.sh/uv/getting-started/installation/) (`brew install uv`)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (runs the local Postgres)

## Database commands (run at the repo root)
```bash
docker compose up -d   # start Postgres on 127.0.0.1:5434 (data kept in a volume)
docker compose down    # stop it (add -v to also delete the data)
```

## API commands (run inside `api/`)
```bash
uv sync              # create .venv and install dependencies
uv run pytest        # run tests (exit code 5 = "no tests collected" until step 2)
uv run ruff check    # lint
uv run alembic upgrade head     # apply all migrations
uv run alembic downgrade base  # undo all migrations
uv run alembic current          # which revision the database is at
```

## CI
GitHub Actions (`.github/workflows/ci.yml`) runs `ruff check` and `pytest` against a Postgres service container on every push and pull request.
