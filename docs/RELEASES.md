# Releases: how to find the exact code of each app

One repository holds everything (worker app, admin portal, database, docs). Each app has its own **release tags**, so you can always see exactly what was tested or went live.

## Where to look (easiest first)

1. **GitHub Releases page:** https://github.com/abdullah-automates31/DHA-Works-Platform/releases . One entry per release, with a plain-English summary, what was tested, and what is still open. Click "Source code (zip)" to download that exact version.
2. **Tags list:** https://github.com/abdullah-automates31/DHA-Works-Platform/tags
3. **This file:** the table below.

## Tag names

- `admin-vX.Y.Z` is the admin portal (`apps/admin`).
- `worker-vX.Y.Z` is the worker app (`apps/worker`).
- (The customer app is Shariq's separate repository: `ShariqKhan96/DHAWorks-Customer`.)
- `0.9.x` = release candidate (tested, not yet live). `1.0.0` = first live version.
- Every tag points at one commit on `dev` (later `main`). Nothing moves a tag after it is published.

## Releases

| Tag | Commit | Date | What it is | Tested |
|---|---|---|---|---|
| `admin-v0.9.0` | `5d2b4a1` | 13 Nov 2026 | Admin portal, all screens A01 to A15, step-up codes, idle logout, bot check, error pages | Local: 74 unit tests, 36 database test files (1,406 checks), security drill 39/39, click-through in a browser. **Not deployed; real email and bot check not yet proven on a live site.** See `docs/ADMIN-QA.md`. |
| `worker-v0.9.0` | `b6ff619` | 12 Nov 2026 | Worker app with the "Bill not attached yet" pop-up, job lock rule, Android hardening | 256 unit tests; installed and tried on a Motorola phone (EAS build `bfa36333`). See `docs/TEST-PLAN.md`. |

## How to get one

```
git fetch --tags
git tag -l                      # list every release tag
git show admin-v0.9.0           # the description and the commit
git switch --detach admin-v0.9.0   # look at the code as it was in that release
```

To see only one app's folder, use a sparse checkout:

```
git clone --filter=blob:none --sparse https://github.com/abdullah-automates31/DHA-Works-Platform.git
cd DHA-Works-Platform
git sparse-checkout set apps/admin packages supabase docs   # or apps/worker for the worker app
git switch --detach admin-v0.9.0
```

## What changed between two releases

```
git log --oneline worker-v0.9.0..worker-v1.0.0
git diff --stat admin-v0.9.0 admin-v1.0.0 -- apps/admin
```

## How a new release is made

1. Everything is tested on `dev` (`docs/TEST-PLAN.md`, `docs/ADMIN-QA.md`).
2. A tag is created on that commit with a short description, then pushed.
3. A GitHub Release is created from the tag with the summary and the "not verified" list.
4. A row is added to the table above.
