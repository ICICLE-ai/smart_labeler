# Testing Model

This document defines how a change is verified before it is merged and before it is
deployed. It is written to be adopted unchanged across our repositories: the level
definitions, the merge and deployment criteria, the user-test rules, and the adoption
notes are intended to be copied verbatim.

Three sections are repo-specific and must be rewritten when this document is copied
elsewhere: **Level 0** (the local commands), **Level 1** (the workflow inventory), and
**Level 3** (the deployment commands and checklist). Everything else carries over.

## Current position on unit tests

This repository has no unit tests, and that is a deliberate decision rather than an
oversight. Writing them for the existing surface area — a Remix client, five extracted
npm packages, and a Flask API with about forty routes — is a large up-front cost that
the project has chosen to defer. Unit tests will be added later, and when they are, they
become a blocking CI gate like any other.

What is deferred is *automated* testing, not verification. Until a unit test suite
exists, the evidence that a change works is manual verification, recorded in a user test
document committed alongside the change. That is not optional, and it is not a weaker
substitute that can be skipped when a change looks obvious. A change with no automated
coverage and no written verification has no evidence behind it at all.

Until the suite exists:

- Keep logic in small pure functions, separated from React components, Remix loaders,
  and Flask route handlers. Code shaped this way is cheap to test later; code that is
  not will have to be restructured before it can be tested at all.
- Do not introduce a test framework as part of an unrelated pull request. Adding a
  runner, its configuration, and its CI wiring is its own change and needs its own
  review.
- Volunteered tests are welcome. Ask a maintainer where they should go before writing
  them, so the layout does not have to be redone when the suite is set up properly.
- Record verification gaps in the pull request. If you could not exercise a path, say
  which one and why.

The tooling below is the intended future direction. **None of it is in effect today** —
none of these tools are installed, configured, or run by CI, and no configuration file
for any of them exists in this repository.

| Area | Language | Intended tooling | Status |
|---|---|---|---|
| `client/` | TypeScript / React | Vitest + React Testing Library | Not yet in effect |
| `packages/*` | TypeScript / React | Vitest per workspace, run from `packages/` | Not yet in effect |
| `server/` | Python 3.12 | pytest, with the Flask test client for route coverage | Not yet in effect |
| End-to-end | — | Playwright against a locally running client and server | Not yet in effect |
| Linting | TypeScript / Python | ESLint + Prettier; Ruff | Not yet in effect |

## Levels of verification

| Level | What it is | Who runs it | When | Blocks merge |
|---|---|---|---|---|
| 0 | Local pre-submit checks — the same build and typecheck commands CI runs, executed on your machine before you push | Contributor | Before opening or updating a pull request | No, but a failure here fails Level 1 |
| 1 | Automated CI gates — the GitHub Actions workflows in `.github/workflows/` | GitHub Actions | On every pull request, and on push to `main` | Yes |
| 2 | Manual functional verification — exercising the change by hand, recorded as a user test document in `docs/user-tests/` | Contributor | Before requesting review | Yes, when the change is behavioural |
| 3 | Deployment verification — building the container images and running the deployment | Contributor or release manager | Before a release, and for any change to the build or deployment surface | Yes for deployment; not for an ordinary merge |

## Which levels apply to my change?

| Change type | Level 0 | Level 1 | Level 2 | Level 3 |
|---|---|---|---|---|
| Documentation only | Not required | Automatic | Not required | Not required |
| Refactor with no behaviour change | Required | Automatic | Required — regression check on the refactored path | Not required |
| Behaviour change | Required | Automatic | Required — full user test document | Not required unless deployment-visible |
| Dependency change | Required | Automatic | Required — exercise the code paths using the dependency | Required if the dependency is installed in an image |
| Build, container, or deployment change | Required | Automatic | Required if user-visible | Required |
| Release | Required | Automatic | Required — link the user test documents covering the release | Required |

"Automatic" means CI runs it whether you want it or not; you do not get to opt out, but
you also do not have to do anything to trigger it.

## Level 0 — local pre-submit checks

Run these in this order. It is the same order CI runs them in, so a failure here is a
failure in CI.

```bash
# 1. Shared packages — build before typecheck.
cd packages
npm ci
npm run build
npm run typecheck
```

The ordering constraint is real, not stylistic: `image-annotator` depends on its sibling
workspaces and resolves their types through the `dist/` output that `npm run build`
produces. Running `npm run typecheck` first on a clean checkout fails with unresolved
`@icicle-ai/*` imports.

```bash
# 2. Client.
cd ../client
npm ci
npm run build
```

`npm run typecheck` exists in `client/package.json` but is **not** run by CI and does not
pass today. The vendored `client/app/components/formik-mantine` tree and several
`*.story.tsx` files fail `tsc` against dependencies that are not installed
(`@storybook/react`, `@mantine/dates`) and against a missing `../../shared` module. Run
it if you are working in the client and want to see type errors in your own code, but
expect pre-existing failures unrelated to your change.

```bash
# 3. Server and repository-wide checks.
cd ..
python -m compileall -q server
python -m pip install --disable-pip-version-check pyyaml
git ls-files '*.yml' '*.yaml' -z | xargs -0 python -c '
import sys, yaml
failed = False
for path in sys.argv[1:]:
    try:
        with open(path) as handle:
            list(yaml.safe_load_all(handle))
    except yaml.YAMLError as error:
        print(f"Invalid YAML in {path}: {error}")
        failed = True
sys.exit(1 if failed else 0)
'
git ls-files '*.sh' -z | xargs -0 -r -n1 bash -n
```

`compileall` proves every server module parses. It does not import them, so it will not
catch a bad import, a missing dependency, or anything that happens at module load — and
`server/db.py` opens a database connection pool at import time, so importing the server
requires a reachable PostgreSQL.

### Toolchain versions

| Toolchain | Version CI uses | Where it is pinned |
|---|---|---|
| Node.js | 20 | `env.NODE_VERSION` in [.github/workflows/build.yml](../.github/workflows/build.yml) |
| npm | Whatever ships with Node 20 | Not pinned — no `packageManager` or `engines` field in any manifest |
| Python | 3.12 | `setup-python` input in [.github/workflows/build.yml](../.github/workflows/build.yml), matching `python=3.12` in [labeler_env.yaml](../labeler_env.yaml) |
| TypeScript | ^5.6.3 | `devDependencies` in [client/package.json](../client/package.json) and [packages/package.json](../packages/package.json) |

Dependencies are installed with `npm ci` against the committed lockfiles
`client/package-lock.json` and `packages/package-lock.json`. Do not use `npm install` in
CI-equivalent runs — it can rewrite the lockfile and hide a resolution difference.

Note that the container images do **not** use Node 20: the root
[Dockerfile](../Dockerfile) installs the `nodejs:18` DNF module and
[client/Dockerfile](../client/Dockerfile) uses `FROM node:18`. CI builds on 20 so that a
future bump of the images has already been proven green.

## Level 1 — automated CI gates

| Workflow | File | Triggers | What it proves |
|---|---|---|---|
| Build | [.github/workflows/build.yml](../.github/workflows/build.yml) | `push` to `main`, `pull_request` (any base branch), `workflow_dispatch` | The packages build and typecheck, the client builds, every server module parses, every tracked YAML file parses, every tracked shell script parses |
| Repository health | [.github/workflows/repository-health.yml](../.github/workflows/repository-health.yml) | `pull_request` (any base branch), `push` to `main` | A fixed list of contribution-readiness files exists |
| Secret Scan | [.github/workflows/secret-scan.yml](../.github/workflows/secret-scan.yml) | `push` to `main`, `pull_request` (any base branch), weekly `schedule` (`0 6 * * 1`), `workflow_dispatch` | No detectable secrets in the changed commits, or in the full history on non-PR runs |

All three declare `permissions: contents: read`. `Build` and `Secret Scan` set a
concurrency group keyed on workflow and ref, cancelling in-progress runs for pull
requests only. `Repository health` sets no concurrency group, so its runs are never
cancelled and can pile up on a rapidly updated branch.

### Build

Three independent jobs, all on `ubuntu-latest`.

**`packages` — "Build shared packages"**, with `working-directory: packages`.

1. `actions/checkout@v4`.
2. `actions/setup-node@v4` with `node-version: 20`, npm cache keyed on
   `packages/package-lock.json`.
3. `npm ci`.
4. `npm run build` — runs `npm run build --workspaces`, which is `tsup` in each of the
   five workspaces, emitting ESM, CJS and `.d.ts` into each `dist/`.
5. `npm run typecheck` — `tsc --noEmit` in each workspace. Runs after the build for the
   dependency reason described in Level 0.

**`client` — "Build client"**, with `working-directory: client`.

1. `actions/checkout@v4`.
2. `actions/setup-node@v4` with `node-version: 20`, npm cache keyed on
   `client/package-lock.json`.
3. `npm ci`.
4. `npm run build` — `remix vite:build`.

There is no typecheck step in this job. The workflow comments say so explicitly and give
the reason. A type error in the client that does not break the Vite build will pass CI.

**`server` — "Check server"**, running at the repository root.

1. `actions/checkout@v4`.
2. `actions/setup-python@v5` with `python-version: "3.12"`.
3. `python -m compileall -q server` — byte-compiles every module under `server/`. A full
   `conda env create` from `labeler_env.yaml` takes many minutes per run, so this checks
   that every module *parses*, not that it imports.
4. `python -m pip install --disable-pip-version-check pyyaml`.
5. Validate YAML manifests — `yaml.safe_load_all` over every tracked `*.yml` and
   `*.yaml`, covering the conda env specs, the Kubernetes manifests and the component
   descriptors. This proves the files are well-formed YAML. It does not validate them
   against any schema, so a manifest with a misspelled Kubernetes field passes.
6. Check shell scripts parse — `bash -n` over every tracked `*.sh`. Syntax only; the
   scripts are never executed.

No server dependency is installed and no server module is imported. This job is a parse
gate, not a smoke gate and not a test suite.

### Repository health

A single job, `required-project-files`, on `ubuntu-latest`: checkout, then a shell loop
asserting that each path in a hard-coded `required_files` array exists, exiting non-zero
if any is missing. It checks existence only — not content, not freshness, not whether the
file says anything useful.

The list currently covers `LICENSE`, `README.md`, `CONTRIBUTING.md`,
`CODE_OF_CONDUCT.md`, `SECURITY.md`, `CITATION.cff`, `docs/RELEASE_CHECKLIST.md`,
`docs/MAINTAINER_ROLES.md`, `docs/TESTING.md` and `docs/user-tests/TEMPLATE.md`.

### Secret Scan

Two jobs.

**`gitleaks` — "Detect secrets (gitleaks)"**

1. `actions/checkout@v4` with `fetch-depth: 0`, so the full history is available.
2. Install Gitleaks — downloads the `8.30.1` Linux x64 release tarball, verifies it
   against a pinned SHA-256, extracts the binary to `/usr/local/bin`, prints the version.
   The version and digest are pinned in the job `env` rather than resolved from the
   releases API, which is unauthenticated and rate limited per runner IP.
3. Scan for secrets — on a pull request, `gitleaks git . --log-opts "$BASE_SHA..$HEAD_SHA"
   --redact`, covering only the commits the pull request adds. On any other event,
   `gitleaks git . --redact` over the whole history. The SHAs are passed through the
   environment rather than interpolated into the script body, so a workflow input can
   never become shell syntax.

**`trufflehog` — "Detect secrets (trufflehog)"**

Gated on `if: github.event_name == 'push' || github.event_name == 'pull_request'`.

1. `actions/checkout@v4` with `fetch-depth: 0`.
2. `trufflesecurity/trufflehog`, pinned to the commit tagged `v3.97.0`
   (`bcfcf73aaf4759d4dadc2783177c245a02792318`), with `path: ./` and
   `extra_args: --results=verified,unknown`. `base` and `head` are deliberately unset so
   the action derives the correct commit range per event type. `--results=verified,unknown`
   keeps findings whose verification was inconclusive, which `--only-verified` would
   discard along with any real credential whose verification request happened to fail.

This job does not run on the weekly schedule or on manual dispatch — the action only
derives a commit range for `push` and `pull_request` events, and on other events it emits
a malformed argument pair. The periodic full-history rescan is therefore covered by the
`gitleaks` job alone.

### What CI does not check today

- **No unit, integration, or end-to-end tests.** Nothing exercises any code path.
- **No linting or formatting.** No ESLint, Prettier, Ruff, or Flake8 configuration exists
  anywhere in the repository, and no workflow runs one.
- **No client typecheck.** `client`'s `npm run typecheck` is not wired into CI and does
  not pass today.
- **No server import or dependency check.** `compileall` proves modules parse. Nothing
  installs `labeler_env.yaml`, imports a module, or starts the Flask app.
- **No container build.** Neither [Dockerfile](../Dockerfile),
  [client/Dockerfile](../client/Dockerfile), nor [server/Dockerfile](../server/Dockerfile)
  is built by any workflow. A change that breaks an image build passes CI.
- **No Kubernetes manifest validation.** The manifests in [k8s/](../k8s/) are parsed as
  YAML and nothing more. No schema check, no `kubectl --dry-run`.
- **No dependency vulnerability scanning and no Dependabot.** There is no
  `.github/dependabot.yml`, no `npm audit` step, and no Python advisory check.
- **No API contract check.** The Flask app defines an OpenAPI document, and nothing
  validates it or diffs it between commits.
- **No check that a new environment variable was added to every manifest.** That is a
  Level 3 checklist item, done by hand.

## Level 2 — manual functional verification

Because there are no automated tests, this is where the evidence that a change works
actually comes from. For any behavioural change, exercise the change by hand and write it
up. The minimum bar is all six of these:

1. **Happy path.** The change doing the thing it was written to do, with ordinary inputs,
   end to end from the user interface — not from a `curl` against one route, unless the
   route *is* the user-facing surface.
2. **At least one edge case.** An empty input, a boundary value, the largest realistic
   input, a slow response, a second concurrent user — whichever is plausible for the code
   you touched.
3. **At least one failure case.** What the user sees when the thing fails: an invalid
   input, a missing permission, an unreachable Tapis system, a rejected job. "It errors"
   is not a result; record the actual message or state.
4. **A regression check on adjacent behaviour.** Exercise the nearest thing you did not
   intend to change. If you touched the annotation canvas, check that saving and importing
   annotations still work. If you touched a Flask route, check the neighbouring routes on
   the same blueprint.
5. **Screenshots for any visual change.** Before and after, in the same viewport, for
   every screen the change affects. Attach them to the pull request and reference them
   from the user test document.
6. **Written up and committed in the same pull request** as `docs/user-tests/YYYY-MM-DD-<slug>.md`,
   from [docs/user-tests/TEMPLATE.md](./user-tests/TEMPLATE.md).

If a step in the bar does not apply, say so in the "Not tested" section of the document
and say why. Omitting it silently is the thing this model exists to prevent.

## Level 3 — deployment verification

The repository ships three images: a combined image at the root that runs both the client
and the server, a client-only image, and a server-only image.

```bash
# Combined image — Rocky Linux 8 + Miniconda + Node 18 + the client build.
# This is a long build; it creates the full conda environment from labeler_env.yaml.
docker build -t smart-labeler:local .

# Client only. Build context is client/ — it contains its own downloadStream.js.
docker build -t smart-labeler-client:local client

# Server only. Build context is server/ — it contains its own labeler_env.yaml.
docker build -t smart-labeler-server:local server
```

Run them. Every one of these needs a reachable PostgreSQL: `server/db.py` builds its
connection pool at import time, retrying `DB_CONNECT_ATTEMPTS` times (default 5, with
exponential backoff) and then raising, so the server process will not start without a
database.

```bash
# Combined: Remix on 3000, Flask on 11112.
docker run --rm -p 3000:3000 -p 11112:11112 \
  -e API_BASE_URL=http://127.0.0.1:11112 \
  -e DB_HOST=host.docker.internal -e DB_PORT=5432 \
  -e DB_NAME=postgres -e DB_USER=<user> -e DB_PASSWORD=<password> \
  smart-labeler:local

# Client only: Remix on 3000, pointed at a server you are already running.
docker run --rm -p 3000:3000 -e API_BASE_URL=http://host.docker.internal:11112 \
  smart-labeler-client:local

# Server only: Flask on 11112.
docker run --rm -p 11112:11112 \
  -e DB_HOST=host.docker.internal -e DB_PORT=5432 \
  -e DB_NAME=postgres -e DB_USER=<user> -e DB_PASSWORD=<password> \
  -e SMART_LABELER_CLASS_SUPPORT_IMAGE=<postit-url> \
  -e SMART_LABELER_PROPOSAL_GENERATION_IMAGE=<postit-url> \
  -e SMART_LABELER_CLASSIFICATION_IMAGE=<postit-url> \
  smart-labeler-server:local
```

For running the two halves directly on your machine rather than in containers, follow
[setup.md](../setup.md) instead. The Kubernetes manifests in [k8s/](../k8s/) are applied
with `kubectl apply -f k8s/deployment.yaml -n <namespace>`; read the header comment in
each file for the values that must be substituted first.

### Deployment verification checklist

**Images build clean**

- [ ] Every image affected by the change builds from a clean checkout with no cached
      layers (`docker build --no-cache`).
- [ ] The build emits no new warnings, and no step silently swallows a failure.
- [ ] The image size did not grow unexpectedly.

**Healthchecks pass**

- [ ] The Remix client answers `GET http://localhost:3000/` with a 200. This is the exact
      path the Kubernetes readiness and liveness probes use in
      [k8s/deployment.yaml](../k8s/deployment.yaml), so it must work.
- [ ] The Flask API answers on 11112. `curl -i http://localhost:11112/pipes` with no
      `Tapis-Token` header returns 401 — that is the correct response, and it proves the
      app is up and routing.
- [ ] The container log shows `done connecting to database`, printed by `server/db.py`
      once the pool is built.
- [ ] The container stays up. Watch it for long enough to see it is not crash-looping on
      a delayed failure.

There is no dedicated health endpoint. The probes commented out in
[k8s/server-deployment.yaml](../k8s/server-deployment.yaml) reference `/api/health`, which
does not exist in the Flask app; do not uncomment them expecting them to work.

**Environment variables**

- [ ] Every new environment variable is documented — in [setup.md](../setup.md) for local
      runs, and in the ConfigMap comments for deployment.
- [ ] Every new variable is present in **every** manifest that needs it:
      [k8s/deployment.yaml](../k8s/deployment.yaml) (combined) and
      [k8s/server-deployment.yaml](../k8s/server-deployment.yaml) (server only). These two
      ConfigMaps are maintained separately and drift easily.
- [ ] Unset behaviour is sane. Either the code supplies a safe default, or it fails
      immediately with a message that names the variable. A variable that defaults to a
      developer's local value is not a safe default.
- [ ] A secret is in the `Secret`, never the `ConfigMap`.

**No secrets in images**

- [ ] `docker history --no-trunc <image>` shows no credential in any build argument or
      command.
- [ ] `docker run --rm <image> env` shows no baked-in credential.
- [ ] No `.env`, key, certificate, or local database file was copied into the image.
      Check the `.dockerignore` covering each build context —
      [client/.dockerignore](../client/.dockerignore) and
      [server/.dockerignore](../server/.dockerignore) exist; the repository root has none,
      so the root [Dockerfile](../Dockerfile) copies `client/` in full, including anything
      untracked sitting in it.
- [ ] The `Secret Scan` workflow passed on the commit being deployed.

## Merge criteria

A reviewer should be able to check every one of these before approving.

- [ ] The pull request describes the problem and links the related issue.
- [ ] All CI gates in Level 1 are green.
- [ ] Level 0 commands relevant to the change were run locally, and the pull request says
      so.
- [ ] A user test document exists for any behavioural change, is committed in this pull
      request, and its result is recorded.
- [ ] The user test document meets the Level 2 minimum bar, or explicitly says which part
      it does not meet and why.
- [ ] Screenshots are attached for every user-visible change.
- [ ] Documentation is updated where behaviour, interfaces, configuration, installation,
      or limitations changed.
- [ ] New environment variables, dependencies, and trust boundaries are identified.
- [ ] Known verification gaps are stated in the reviewer notes.

**A pull request is not blocked for missing unit tests.** Do not request them as a
condition of approval while the suite is deferred.

**A pull request is blocked for a missing user test document when one applies.** The
matrix above decides whether one applies. This is the gate that replaces the missing test
suite, so waiving it leaves the change with no evidence behind it at all.

## Deployment criteria

Everything under Merge criteria, plus:

- [ ] Level 3 deployment verification was performed and recorded — as a user test document
      with the deployment checklist filled in, or in the release record.
- [ ] The release is traceable to a tag, and the tag identifies the source commit.
- [ ] [docs/RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) is complete.
- [ ] Release notes state the known test gaps, **including the absence of unit tests**,
      and name what was verified by hand instead.
- [ ] A rollback path is known and written down: the previous image tag, the previous
      release tag, and any schema or configuration change that would have to be undone
      with it.

## User test documentation

User test documents live in [docs/user-tests/](./user-tests/) and are named
`docs/user-tests/YYYY-MM-DD-<slug>.md` — the date the test was run, then a short
hyphenated slug describing the change, for example
`docs/user-tests/2026-08-19-sam3-text-prompt-mode.md`.

Start from [docs/user-tests/TEMPLATE.md](./user-tests/TEMPLATE.md), which carries the
required sections as fill-in tables.

| Section | Required | What goes in it |
|---|---|---|
| Header table | Yes | Date, tester, pull request or issue, commit SHA tested, overall result |
| Environment | Yes | Where it ran — local, container, or cluster — plus Node, Python, browser, and image tag as applicable |
| Scope | Yes | What this document covers, in one or two sentences |
| Preconditions | Yes | Accounts, data, systems, and environment variables needed to reproduce the run |
| Test cases | Yes | The happy path, as steps / expected / actual / pass-fail |
| Edge cases | Yes | At least one, in the same table shape |
| Failure cases | Yes | At least one, in the same table shape |
| Regression check | Yes | The adjacent behaviour you exercised and what it did |
| Evidence | For visual changes | Screenshots, recordings, log excerpts, job IDs |
| Issues found | Yes | Anything that failed or looked wrong, with an issue link where one was filed. "None" is a valid entry |
| Not tested | Yes | What you did not exercise, and why |

Rules for writing them:

1. Write steps a stranger can follow. Name the page, the button, the field, and the value
   you entered. "Configured the job and submitted it" is not a step.
2. Record the expected result before you run the step, not after you see what happened.
   Writing the expectation afterwards turns every run into a pass.
3. Record failures. A document with no failures in it is not a better document; it is
   usually a less careful one. A failed case that is understood and linked to an issue is
   a good outcome.
4. Use public, synthetic, or de-identified data only. No credentials, no tokens, no
   restricted datasets, no sensitive locations, no personal information — not in the
   steps, not in the screenshots, not in the pasted logs. Redact hostnames and job IDs
   that identify a private system.
5. Keep it to about a page. This is a record of what you did, not a specification. If it
   is running long, the change is probably too large for one document.
6. Never edit a past document. It records what was true on a specific commit on a
   specific date. If something changed, write a new one.
7. Say what you did not test. The "Not tested" section is the most useful part of the
   document for the next person, and leaving it empty to look thorough is the one failure
   mode this model cannot detect.

## Adopting this model in another repository

**Copy verbatim:**

- The "Current position on unit tests" section, minus the tooling table.
- The four-level table and the "Which levels apply to my change?" matrix.
- The Level 2 minimum bar.
- Merge criteria and Deployment criteria.
- The whole "User test documentation" section, including the naming convention, the
  required-sections table, and the seven rules.
- `docs/user-tests/TEMPLATE.md` and `docs/user-tests/README.md`.

**Adapt per repository:**

- Level 0 — the real commands from that repository's manifests, in the order its CI runs
  them, with its own toolchain versions and pinning locations.
- Level 1 — the actual workflow inventory. Rewrite it from the workflow files, not from
  this document.
- Level 3 — the real build and run commands, the real health checks, the real manifests.
- The intended-future-tooling table, for that repository's languages.
- The related-documents list.

**Invariants, whatever the stack:**

- Four levels, in the same order, with the same meanings.
- Deferring unit tests defers automation, never verification.
- A behavioural change without a user test document does not merge.
- Level 0 is exactly what Level 1 runs, so a local pass predicts a CI pass.
- The workflow inventory states what each gate proves *and* what it does not.
- User test documents are immutable once merged.
- A missing unit test never blocks a merge while the suite is deferred.

## Related documents

- [CONTRIBUTING.md](../CONTRIBUTING.md) — how to contribute and what a pull request should
  contain
- [docs/RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) — the checklist to complete before a
  public release
- [docs/MAINTAINER_ROLES.md](./MAINTAINER_ROLES.md) — who owns review, release, and
  security response
- [SECURITY.md](../SECURITY.md) — reporting a vulnerability; contributor security
  expectations
- [setup.md](../setup.md) — running the client and server locally
- [docs/user-tests/README.md](./user-tests/README.md) — the user test record
- [docs/user-tests/TEMPLATE.md](./user-tests/TEMPLATE.md) — the user test template
- [README.md](../README.md) and [SEGMENTATION_README.md](../SEGMENTATION_README.md) — the
  pipelines a user test exercises
