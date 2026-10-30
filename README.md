# Studio platform

[![CI](https://github.com/GalHavshush/studio-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/GalHavshush/studio-platform/actions/workflows/ci.yml)

A multi-tenant backend for small coach-led studios (BJJ, MMA, pilates, yoga, CrossFit, dance).

Most studio software is built around bookings and payments. This project is built around a different idea: **coaches build a shared history of each participant**. After a class the coach files a report, with a private note per attendee. Over time the studio, and the member, build on one record instead of scattered memories and chat messages.

It is a learning project, built step by step from a written roadmap, with Claude Code as a pair programmer. Every step is reviewed, tested and committed by me, and the design decisions below are the part I care most about.

**Stack:** Python 3.14, FastAPI, SQLAlchemy 2 (async), PostgreSQL, Alembic, Pydantic, argon2, JWT, pytest, ruff, uv, GitHub Actions. A mobile app (Expo / React Native, with a TypeScript client generated from the OpenAPI schema) is the next milestone.

## What it does today

- **Studios and roles.** One account can belong to several studios with a role in each (owner, coach, member). Roles are cumulative.
- **Schedule.** Class types, sessions, cancellations, archiving, UTC storage with timezone-aware input only.
- **Attendance, kept apart from plans.** An RSVP is what someone *plans* to do. Attendance is what *happened*. They are separate records and separate endpoints.
- **Booking module.** A studio can switch on capacity limits with a waitlist that promotes people automatically.
- **Class reports and participant notes.** Coaches write a report with notes per attendee, saved atomically. A note can be shared with the member it is about.
- **Participant timeline.** One entry per class (booking, attendance, summary, notes), newest first, cursor-paginated.
- **Account deletion.** Anonymizes the account and erases what is about the person, while keeping the studio's own class history. Required by App Store and Google Play.

The API is documented interactively at `/docs`, `/redoc` and `/scalar` when the server runs.

## Architecture at a glance

```mermaid
flowchart LR
    C[Client] -->|"Bearer token + X-Tenant-Id"| U[current_user<br/>verify JWT]
    U --> T[TenantCtx<br/>membership and role]
    T --> R[require_role / require_module]
    R --> H[Route handler]
    H -->|"every query filtered by tenant_id"| DB[(PostgreSQL)]
```

A modular monolith: one FastAPI app, one Postgres database, one router per area (`sessions`, `bookings`, `attendance`, `reports`, `participants`, `timeline`, ...). No queues, caches or microservices, because nothing here needs them yet. Authentication, tenant resolution and role checks are FastAPI dependencies, so a route declares what it requires in its signature and cannot forget to check.

## Design decisions

### 1. Tenant isolation is enforced in three layers, and CI fails if one is skipped

All studios share one schema; every tenant-owned row carries a `tenant_id`.

- **Request layer.** The studio comes from the `X-Tenant-Id` header, but the header is never trusted: `TenantCtx` verifies that the caller has a membership in that studio and uses *that* role. The studio is never read from a request body.
- **Query layer.** Every query filters by the verified tenant. A session, participant or class type from another studio gets the **same 404** as one that does not exist, so ids cannot be probed.
- **Database layer.** Cross-studio links are impossible even if application code is wrong: parent tables expose `UNIQUE (tenant_id, id)` and child tables reference the pair with composite foreign keys, so Postgres itself refuses an RSVP in studio A that points at a session in studio B.
- **Guardrail.** A test registry lists every tenant-scoped route. A new route that is not registered, or that does not reject a member of another studio, fails CI.

### 2. Authentication: short-lived JWTs, rotating refresh tokens, reuse detection

- Access tokens are JWTs that live 15 minutes. Refresh tokens are opaque random strings, valid 30 days, and stored only as hashes.
- Every refresh **rotates** the token. Presenting an already-used token means it was probably stolen, so the whole token family is revoked and both the thief and the owner must log in again.
- Concurrent refreshes of one account could each pass the check and fork a family, so a row lock on the user serializes them (tested with real concurrent transactions).
- Passwords use argon2, run in a thread pool so the deliberately slow hash does not block the event loop. Unknown email, wrong password and no password all return the identical 401, and a dummy hash is verified for unknown emails so response time does not reveal which emails exist.

### 3. A race condition, proved first and then fixed

Two people booking the last seat could both succeed: both count the seats, both see one free, both insert. No `if` in application code can close that gap.

1. A test reproduced it deterministically using a barrier that holds both requests between the check and the write. It was committed as a strict expected-failure, so the bug was documented in the suite.
2. The fix locks the session row (`SELECT ... FOR NO KEY UPDATE`) before counting, so the second request waits and then sees the committed result. The test flipped to passing.
3. The lock is *no key* on purpose: it excludes other changers (RSVPs, capacity edits, cancellation) but not plain attendance inserts that merely reference the row through a foreign key. A test checks that attendance is not blocked while a booking holds the lock.
4. The mirror-image bug, two simultaneous cancellations leaving a seat empty while someone waits, has its own test.

### 4. Privacy is a design input, not a filter at the end

- **Fail private.** A note is staff-only unless explicitly shared, and re-saving a note without the flag makes it private again. An unknown role gets the member view.
- **Filter in the query.** What a member must not see is never fetched, so a later bug in serialization cannot leak it.
- **One rule, one place.** "Which class summaries may a member read?" lives in a single function used by the report endpoint and the timeline, with a test that the two always agree.
- **No side channels.** On a member's timeline a class that has only a private note is omitted entirely, since even an empty entry would reveal that such a note exists. A member asking for someone else's participant gets the same 404 as for an id that does not exist.
- Free-text fields reject NUL characters at the edge, because Postgres cannot store them and the client would otherwise get a 500.

### 5. Pagination that stays correct while data changes

The timeline uses **keyset pagination** on `(starts_at, id)`, not `OFFSET`. A class added while someone scrolls cannot shift the pages and repeat an item, and page 50 costs the same as page 1. The id is a tie-breaker (tested with five classes at the same instant), and the query fetches one extra row to know whether a next page exists. Each page costs four queries however long it is, so there is no N+1.

### 6. Deleting an account without breaking the studio's records

Deleting a user outright would break every report, note and RSVP that points at them. Instead the account is **anonymized in place**: same id, so foreign keys keep working, but the email becomes `deleted-<id>@deleted.invalid`, the name and password are gone and all sessions are revoked immediately. Notes *about* the person and their upcoming bookings are erased (their seat goes to the next person on the waitlist, in the same transaction). Class reports, past attendance and authored records are kept without a name. The whole policy lives in one file, `app/deletion.py`, so it can change in one place if legal advice differs.

### 7. Optional features per studio

Studios switch capabilities on through a `modules` list (for example `booking`). A dependency, `require_module`, guards the routes, so a studio that never enabled booking cannot be affected by seat limits, and new modules do not touch the core.

### 8. Time

Times are stored in UTC. The API rejects timestamps without an offset instead of guessing a timezone, and returns UTC. Studios carry their own timezone for display.

## How it is tested

The suite has about 465 tests and runs in CI against a real Postgres, never mocks.

- **Fast tests roll back.** Each test runs in a transaction that is rolled back, so tests are isolated and quick.
- **Concurrency tests really commit.** The few tests about locks and races use separate connections and real commits.
- **Races are made deterministic.** A barrier holds requests at the exact interleaving under test instead of hoping for timing, and a helper proves a request is *waiting on a lock* rather than sleeping.
- **Mutation checks by hand.** For each feature the code is deliberately broken in several ways; every mutation must fail a test, and mutations that survive revealed missing tests (an off-by-one in pagination was found this way).
- **Manual end-to-end runs.** Before milestones close, the API is exercised with hundreds of real `curl` requests against a throwaway database. That run found the NUL-character 500, an attendance loophole, and duplicate class names, all since fixed with tests.
- Migrations are tested up, down and up again, and `alembic check` confirms models and migrations agree.

## Roadmap

Milestone 1 (the coaching core, above) is complete. Next: an Expo / React Native app using a TypeScript client generated from the OpenAPI schema, then the studio-facing features (timezone-aware schedules, push notifications, invitations, Sign in with Apple and Google, and store submission requirements such as in-app account deletion).

<details>
<summary><b>Project structure</b></summary>

```
.github/workflows/ci.yml     CI: ruff + pytest for the API, tsc for the app, on every push and pull request
docker-compose.yml           local Postgres (port 5434)
app/                         Expo (React Native, TypeScript) client
├── src/app/                 screens (expo-router: one file = one route): _layout (provider + guarded routes), login, select-studio (shown when no studio is chosen), (tabs)/ (the three main places under a floating tab bar: index (the schedule), timeline ("My classes": the staff's reports to write, the reports about you from last week, then your history) and settings), session/[id] (one session), session/new (create a class: type, day, time, length, seats), session/edit/[id] (edit a class: day, time, length, seats, preview), session/report/[id] (the class report form), class-types/index and class-types/[id] (an owner's list of class types with archive and restore, and the form to create or rename one), timeline/[id] (someone else's history, above the tabs)
├── src/theme/               tokens.ts (colours for light and dark, spacing, type), use-theme.ts (follows the phone's light/dark setting), preference.ts and use-preference.tsx (the saved System/Light/Dark choice and the provider that applies it), with Jest tests (every text and background pair is readable; the stored choice is parsed safely)
├── src/i18n/                en.ts (every sentence the app shows, by key), translate.ts (the translator: lookup, English fallback, {holes}, singular/plural), language.ts and use-language.tsx (the saved System/English choice and the provider), with Jest tests (every language has every key, no key is unused, fallback)
├── src/components/          shared pieces: screen.tsx (Screen, Hero, Sheet), text.tsx, button.tsx, text-field.tsx, pill.tsx, logo.tsx, tile.tsx, row.tsx, back-button.tsx, tab-bar.tsx (the floating bar), page-header.tsx (the slim orange header: back button, title, small logo), week-strip.tsx and today-card.tsx (the schedule's week strip and Today card), delete-account-sheet.tsx, person-row.tsx, add-attendee-sheet.tsx, timeline-card.tsx, timeline-view.tsx, choice-chip.tsx and stepper.tsx (a chip and a +/- number for the class forms), session-fields.tsx (the coach picker for owners and the day, time, length and seats fields shared by the new-class and edit-class forms), class-row.tsx (a class in one line with a tag: the report queue and the history use it) and reports-to-write.tsx (the staff's list of classes waiting for a report), history-row.tsx (a past class in one line that opens its card), attendee-row.tsx (an attendee of the report in one line that opens their note)
├── src/auth/                role.ts (a role as a word, Jest-tested), tokens.ts (secure storage of the two tokens), tenant-id.ts (the studio chosen last time), session.tsx (sign-in, studio state and account deletion: provider and useSession), delete-account.ts (what deleting an account can end in, Jest-tested), auth-fetch.ts (adds the token and X-Tenant-Id, refreshes the token on a 401) with its Jest tests
├── src/schedule/            time.ts (start of day and of the week, day keys, and times in the studio's timezone, including studio time to an instant; Jest-tested), new-session.ts (the new-class form's rules: day choices, times, seats, request body, error messages; Jest-tested) and use-new-session.ts (loads the class types and creates the class), use-staff.ts (an owner's list of who can teach), class-types.ts (the class-type screens' rules: active and archived, which modes are offered, only-what-changed body, error messages; Jest-tested) and use-class-types.ts (loads the types, archived too, and creates, renames, archives and restores), edit-session.ts (the edit-class form's rules: prefill from the class, only-what-changed patch, who may change, error messages; Jest-tested), week.ts (the week strip's days and range, and which of today's classes are done or next; Jest-tested), week-start.ts and use-week-start.tsx (the "week starts on Monday" choice, kept on the phone; Jest-tested), use-schedule.ts (loads the week we are in and grows a week at a time both ways), use-session.ts (loads one session; sends the RSVP, attendance, edit and cancel), plan.ts (RSVP labels, seats text and confirmation messages; Jest-tested), chip.ts (the colour of a class's time chip; Jest-tested), rsvp-list.ts and use-rsvp-list.ts (the staff list of who is coming: grouping, Jest-tested, and loading it on demand), report.ts (the report form's rules: payload, notes per attendee, adding and removing attendees, can-save, dirty, error messages; Jest-tested) and use-report.ts (loads and saves the report, marks someone as having come), use-participant-search.ts and latest.ts (the studio-wide name search, and the "is this still the newest request?" check, Jest-tested), timeline.ts (a timeline's status, page merge, note labels and "reports about you" of last week; Jest-tested) and use-timeline.ts (loads a person's timeline a page at a time), report-queue.ts (a week's window for the report queue, and unwritten-first order; Jest-tested) and use-report-queue.ts (loads the queue a week at a time), attendance.ts (the "did you come?" window and messages; Jest-tested), use-now.ts (a clock that re-renders a screen every so often)
├── src/api/                 the typed API client: client.ts, schema.d.ts (generated), contract-check.ts (calls that must NOT compile)
├── openapi.json             snapshot of the API's schema, the input of the generated types
└── .env.example             EXPO_PUBLIC_API_URL, the API address the app calls
api/                         FastAPI backend (Python, managed with uv)
├── app/
│   ├── main.py              FastAPI app, the /health endpoint, the /scalar docs page, mounts the routers
│   ├── auth.py              POST /auth/login (access + refresh token), POST /auth/refresh, POST /auth/logout
│   ├── class_types.py       GET/POST /class-types, PUT /class-types/{id}, POST /class-types/{id}/archive and /unarchive (a studio's class types; writes are owner-only; archived ones are hidden by default; each has an attendance mode, rsvp or booking)
│   ├── sessions.py          POST/GET /sessions, GET/PATCH /sessions/{id}, POST /sessions/{id}/cancel; the helpers the other session files share (own_session, is_staff)
│   ├── bookings.py          PUT /sessions/{id}/rsvp (going / not_going / maybe; seats are limited in booking mode, with a waitlist and its promotion), GET /sessions/{id}/rsvps (staff only: who is coming, in order, with waiting-list positions)
│   ├── series.py            POST /series, PATCH /series/{id} (change the rule and its future sessions), POST /series/{id}/extend, GET /series, GET /series/{id} (a weekly class rule: class type, coach, weekday, start time in studio time, length, capacity, first and last date; an owner creates, an owner reads all and a coach reads the ones they teach; creating one also generates its next four weeks of sessions, POST /series/{id}/extend tops them up)
│   ├── attendance.py        POST /sessions/{id}/attendance (attended or not; check-in opens 15 min before start)
│   ├── reports.py           PUT /sessions/{id}/report (the coach's class report, with a private note per attendee, saved in one transaction), GET /sessions/{id}/report (staff: the whole report; a member: only the summary, and only if they attended)
│   ├── report_queue.py      GET /report-queue?from&to (staff: the classes that already took place whose report the caller may write, newest first, each with whether a report exists, plus `has_earlier`: whether an older one is waiting; a coach sees their own, an owner all)
│   ├── staff.py             GET /staff (owner only: the studio's coaches and owners by name, for the coach picker)
│   ├── participants.py      GET /participants/{id}/notes (the notes coaches wrote about a participant: staff see all, a member only the notes shared with them about themselves)
│   ├── timeline.py          GET /participants/{id}/timeline (a participant's classes, newest first, with booking, attendance, summary and notes; cursor-paginated; staff see all, a member only their own and what was shared)
│   ├── tenant.py            GET /tenant (the studio named by X-Tenant-Id, with its enabled modules)
│   ├── me.py                GET /me (profile + studio memberships of the logged-in user), DELETE /me (delete the account, confirmed with the password)
│   ├── deps.py              shared dependencies: current_user (verifies the Bearer token), TenantCtx (X-Tenant-Id + membership role), require_role (owner > coach > member), require_module (studio has the module on), is_staff (coach or owner)
│   ├── export_openapi.py    writes the API's OpenAPI schema to a file (python -m app.export_openapi; used by the app's npm run gen:api)
│   ├── text.py              rules shared by every stored free-text field (no NUL characters)
│   ├── deletion.py          what deleting an account erases, anonymizes and keeps (the policy, in one place)
│   ├── config.py            settings read from the environment / .env (DATABASE_URL, JWT_SECRET)
│   ├── db.py                async engine and the per-request session dependency
│   ├── models.py            SQLAlchemy models: User, Tenant, Membership, ClassType, Participant, ClassSeries, ClassSession, Rsvp, ClassReport, ParticipantNote, RefreshToken
│   ├── security.py          password hashing (argon2), access tokens (JWT), refresh-token generation and hashing
│   └── seed.py              creates the pilot studio, its people and their participants, plus a marked demo studio (python -m app.seed)
├── migrations/              Alembic
│   ├── env.py               how Alembic connects (URL comes from app settings)
│   └── versions/            one file per schema change
├── tests/
│   ├── conftest.py          test database, migrated_db, client, real-commit and two-studio fixtures
│   └── test_*.py            config, health, migrations, users, tenants, memberships, seed, security, auth, deps, me, refresh_tokens, logout, refresh, token_families, reuse_detection, tenant_ctx, tenant_isolation, class_types, participants, sessions, rsvps, attendance, modules, capacity, waitlist, booking_race (concurrency and the session row lock), same_studio_links, reports, notes (incl. sharing), report_summaries, report_queue, timeline, series, series_generation, series_edit, account_deletion, nul_characters, seed_demo, session_detail, openapi_snapshot, docs
├── alembic.ini
├── pyproject.toml           dependencies and tool settings
└── .env.example             template for api/.env
```

</details>

## Requirements
- [uv](https://docs.astral.sh/uv/getting-started/installation/) (`brew install uv`)
- [Node.js](https://nodejs.org/) 24+ (for the app in `app/`)
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
uv run python -m app.seed      # create the pilot studio + owner, coach, member, and a demo second studio (safe to re-run)
```

## App commands (run inside `app/`)
```bash
npm install              # first time
npx expo start           # dev server; i = iOS simulator, or scan the QR code with Expo Go on a phone
npm run typecheck        # tsc --noEmit (also runs in CI)
npm test                 # Jest (jest-expo): the token-refresh logic (also runs in CI)
npm run gen:api          # after changing an API route or field: refresh openapi.json and the generated types
cp .env.example .env     # the API address; restart expo after changing it
```

## CI
GitHub Actions (`.github/workflows/ci.yml`) runs two jobs on every push and pull request: the API job (`ruff check` and `pytest` against a Postgres service container) and the app job (`npm ci`, `tsc --noEmit`, which also checks the typed API client, and `npm test`). A test in the API suite fails if `app/openapi.json` is out of date.
