# Working agreement

This is an educational project. Implement exactly ONE step from the plan per request.
Prefer small working vertical slices. If a step needs several new concepts, propose splitting it.

The plan lives in `~/.claude/plans/thinking-on-a-platform-spicy-thompson.md`.

## Before coding a step
- Explain what will be implemented
- Explain the main concepts involved
- List the files expected to change
- Mention important architectural decisions

## After coding
- List every created/modified file
- Explain how the feature works and the request/data flow (HTTP → dependencies → DB → response)
- Point out the most important code to review
- Explain any new FastAPI, SQLAlchemy, Alembic, JWT, async, transaction or dependency-injection concepts
- Explain what the automated tests prove
- Give exact manual verification commands (curl/httpie, expected output)
- Suggest one commit message
- STOP and wait for review

## Do not
- Continue to the next step or implement future roadmap items
- Silently redesign the architecture
- Do unrelated refactors
- Create speculative abstractions, or code that exists only to be deleted later
- Add Redis, queues, microservices, Kubernetes or similar infra unless a real need appears
- Run `git commit` (the developer reviews and commits every step)
