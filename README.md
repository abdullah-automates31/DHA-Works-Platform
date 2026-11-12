# DHA Works

A home-services marketplace for DHA Karachi. A verified resident posts a repair job with photos, several **verified** workers send **itemised quotes**, the resident accepts one, the work is done, and the customer pays **cash**. DHA staff verify every worker and resident and handle reports.

> Status (13 Nov 2026): **database and mobile API built and live on the hosted DEV project (migrations through 0048); the Worker app and the admin portal (screens A01 to A15) are built and tested; the customer app is Shariq Bhai's separate repository.** The admin portal is not deployed yet. Start with [docs/HANDOVER.md](docs/HANDOVER.md) section 0 and find release versions in [docs/RELEASES.md](docs/RELEASES.md).

## The three products

| Product | Who uses it | Tech |
| --- | --- | --- |
| **DHA Works** (customer app) | DHA residents | Expo (React Native) + TypeScript, Android first |
| **DHA Works - Worker** (worker app) | Plumbers, electricians, AC technicians and similar | Expo (React Native) + TypeScript, Android first |
| **DHA admin portal** | DHA staff | Next.js + TypeScript on Vercel |

Backend for all three: **Supabase** (Postgres with Row Level Security, Auth, Storage, Realtime, Edge Functions).

## Documentation map

Read in this order if you are new.

| # | Document | What it answers |
| --- | --- | --- |
| 1 | [docs/IDEA.md](docs/IDEA.md) | The full idea in depth: problem, vision, who it is for, how it works |
| 2 | [docs/FEATURES.md](docs/FEATURES.md) | Every feature by app, in scope now vs later |
| 3 | [docs/USER-FLOWS.md](docs/USER-FLOWS.md) | Step-by-step journeys for customers, workers and staff |
| 4 | [docs/PRD.md](docs/PRD.md) | Product requirements: roles, job lifecycle, quotes, cash, verification, reports, reviews |
| 5 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, repo layout, state machine, backend logic, environments |
| 6 | [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | Summary of tables and database rules |
| 6a | [docs/DB-API-DESIGN.md](docs/DB-API-DESIGN.md) | **Source of truth for the database and mobile APIs:** state machine, tables, RPCs per screen, RLS, open questions |
| 6b | [docs/HANDOVER.md](docs/HANDOVER.md) | **Read first in a new session:** current state, what is built, what is pending, exact next steps |
| 7 | [docs/SECURITY.md](docs/SECURITY.md) | What we protect, auth, RLS, storage, abuse controls, incident response |
| 8 | [docs/UI-UX.md](docs/UI-UX.md) | Design direction, palette, screens, component rules, worker and admin plans |
| 9 | [docs/TESTING.md](docs/TESTING.md) | Test strategy and the tests that matter most |
| 10 | [docs/ROADMAP.md](docs/ROADMAP.md) | Milestones M0 to M11, MVP phases, what waits for later |
| 11 | [docs/DECISIONS.md](docs/DECISIONS.md) | Decisions already made, with dates |
| 12 | [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) | Everything still pending, including questions for Shariq Bhai |
| 13 | [docs/SETUP.md](docs/SETUP.md) | Planned developer setup (Windows, no Mac) |
| 14 | [docs/GLOSSARY.md](docs/GLOSSARY.md) | Terms used across the docs |
| 15 | [docs/WORKER-APP.md](docs/WORKER-APP.md) | Worker app: screen-to-backend map and how to run it |
| 16 | [docs/ADMIN-PORTAL.md](docs/ADMIN-PORTAL.md) | Admin portal: screens, security, how to run and test it, state on 13 Nov |
| 17 | [docs/ADMIN-QA.md](docs/ADMIN-QA.md) | Admin portal QA record: what was clicked, bugs found and fixed, audit, what is still open |
| 18 | [docs/TEST-PLAN.md](docs/TEST-PLAN.md) | The end-to-end rehearsal with real phones, edge cases and security checks |
| 19 | [docs/RELEASES.md](docs/RELEASES.md) | **Release tags** (`admin-vX.Y.Z`, `worker-vX.Y.Z`): how to find and fetch the exact code of each release |

## Source of truth

These files were assembled from the Google Docs written during planning and then updated on 26 to 27 October 2026 to the competing-quotes model confirmed with Shariq Bhai and the three UI designs. Where a document says **Pending**, the decision has not been confirmed with Shariq Bhai. Where two sources disagree, [docs/DECISIONS.md](docs/DECISIONS.md) records which one wins.

## Repository layout (planned, created at M0)

```
DHA-WORKS/
  apps/
    customer/      Expo app (customer)
    worker/        Expo app (worker)
    admin/         Next.js admin portal
  packages/
    shared/        types, constants, validation, money/date helpers
    supabase/      client, generated DB types, query helpers
    ui-native/     shared mobile theme and components
  supabase/
    migrations/    SQL (schema, RLS, functions)
    functions/     Edge Functions
    tests/         pgTAP tests
  docs/            everything listed above
```

## People

- **Builder:** Abdullah
- **Mentor / product owner:** Shariq Bhai
