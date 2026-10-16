# Studio platform

[![CI](https://github.com/GalHavshush/studio-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/GalHavshush/studio-platform/actions/workflows/ci.yml)

Multi-tenant platform for small coach-led studios (BJJ, MMA, pilates, yoga, CrossFit, dance).
Core idea: coaches build a shared history of each participant through class reports and notes.

## Project structure
```
.github/workflows/ci.yml     CI: ruff + pytest on every push and pull request
docker-compose.yml           local Postgres (port 5434)
api/                         FastAPI backend (Python, managed with uv)
├── app/
│   ├── main.py              FastAPI app, the /health endpoint, mounts the routers
│   ├── auth.py              POST /auth/login (access + refresh token), POST /auth/logout
│   ├── me.py                GET /me (profile + studio memberships of the logged-in user)
│   ├── deps.py              shared dependencies: current_user (reads and verifies the Bearer token)
│   ├── config.py            settings read from the environment / .env (DATABASE_URL, JWT_SECRET)
│   ├── db.py                async engine and the per-request session dependency
│   ├── models.py            SQLAlchemy models: User, Tenant, Membership, RefreshToken
│   ├── security.py          password hashing (argon2), access tokens (JWT), refresh-token generation and hashing
│   └── seed.py              creates the pilot studio (python -m app.seed)
├── migrations/              Alembic
│   ├── env.py               how Alembic connects (URL comes from app settings)
│   └── versions/            one file per schema change
├── tests/
│   ├── conftest.py          test database, migrated_db and client fixtures
│   └── test_*.py            config, health, migrations, users, tenants, memberships, seed, security, auth, deps, me, refresh_tokens, logout
├── alembic.ini
├── pyproject.toml           dependencies and tool settings
└── .env.example             template for api/.env
```

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
uv run python -m app.seed      # create the pilot studio + owner, coach, member (safe to re-run)
```

## CI
GitHub Actions (`.github/workflows/ci.yml`) runs `ruff check` and `pytest` against a Postgres service container on every push and pull request.
