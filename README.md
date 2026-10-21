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
│   ├── main.py              FastAPI app, the /health endpoint, the /scalar docs page, mounts the routers
│   ├── auth.py              POST /auth/login (access + refresh token), POST /auth/refresh, POST /auth/logout
│   ├── class_types.py       GET/POST /class-types, PUT /class-types/{id}, POST /class-types/{id}/archive and /unarchive (a studio's class types; writes are owner-only; archived ones are hidden by default; each has an attendance mode, rsvp or booking)
│   ├── sessions.py          POST/GET /sessions, GET/PATCH /sessions/{id}, POST /sessions/{id}/cancel; the helpers the other session files share (own_session, is_staff)
│   ├── bookings.py          PUT /sessions/{id}/rsvp (going / not_going / maybe; seats are limited in booking mode, with a waitlist and its promotion)
│   ├── attendance.py        POST /sessions/{id}/attendance (attended or not; check-in opens 15 min before start)
│   ├── reports.py           PUT /sessions/{id}/report (the coach's class report, with a private note per attendee, saved in one transaction), GET /sessions/{id}/report (staff: the whole report; a member: only the summary, and only if they attended)
│   ├── participants.py      GET /participants/{id}/notes (the notes coaches wrote about a participant: staff see all, a member only the notes shared with them about themselves)
│   ├── timeline.py          GET /participants/{id}/timeline (a participant's classes, newest first, with booking, attendance, summary and notes; cursor-paginated; staff see all, a member only their own and what was shared)
│   ├── tenant.py            GET /tenant (the studio named by X-Tenant-Id, with its enabled modules)
│   ├── me.py                GET /me (profile + studio memberships of the logged-in user)
│   ├── deps.py              shared dependencies: current_user (verifies the Bearer token), TenantCtx (X-Tenant-Id + membership role), require_role (owner > coach > member), require_module (studio has the module on), is_staff (coach or owner)
│   ├── config.py            settings read from the environment / .env (DATABASE_URL, JWT_SECRET)
│   ├── db.py                async engine and the per-request session dependency
│   ├── models.py            SQLAlchemy models: User, Tenant, Membership, ClassType, Participant, ClassSession, Rsvp, ClassReport, ParticipantNote, RefreshToken
│   ├── security.py          password hashing (argon2), access tokens (JWT), refresh-token generation and hashing
│   └── seed.py              creates the pilot studio, its people and their participants (python -m app.seed)
├── migrations/              Alembic
│   ├── env.py               how Alembic connects (URL comes from app settings)
│   └── versions/            one file per schema change
├── tests/
│   ├── conftest.py          test database, migrated_db, client, real-commit and two-studio fixtures
│   └── test_*.py            config, health, migrations, users, tenants, memberships, seed, security, auth, deps, me, refresh_tokens, logout, refresh, token_families, reuse_detection, tenant_ctx, tenant_isolation, class_types, participants, sessions, rsvps, attendance, modules, capacity, waitlist, booking_race (concurrency and the session row lock), same_studio_links, reports, notes (incl. sharing), report_summaries, timeline, docs
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
cp .env.example .env # first time only: DATABASE_URL and JWT_SECRET (the app won't start without them)
uv sync              # create .venv and install dependencies
uv run fastapi dev   # run the server at http://localhost:8000 (API docs: /docs Swagger, /redoc, /scalar with dark mode)
uv run pytest        # run tests (the database must be up)
uv run ruff check    # lint
uv run alembic upgrade head     # apply all migrations
uv run alembic downgrade base  # undo all migrations
uv run alembic current          # which revision the database is at
uv run python -m app.seed      # create the pilot studio + owner, coach, member (safe to re-run)
```

## CI
GitHub Actions (`.github/workflows/ci.yml`) runs `ruff check` and `pytest` against a Postgres service container on every push and pull request.
