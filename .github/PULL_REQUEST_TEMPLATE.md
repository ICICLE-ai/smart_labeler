## Purpose

Describe the user or maintainer problem addressed by this pull request. Link the related issue.

## Change summary

- 

## Validation performed

See [docs/TESTING.md](docs/TESTING.md) for what each level means and which apply to
this change. Delete any check that does not apply and say why.

Level 0 — local pre-submit checks:

- [ ] `cd packages && npm ci && npm run build && npm run typecheck` (build before typecheck)
- [ ] `cd client && npm ci && npm run build`
- [ ] `python -m compileall -q server`
- [ ] YAML and shell parse checks (`git ls-files '*.yml' '*.yaml'` through `yaml.safe_load_all`; `git ls-files '*.sh' | xargs -n1 bash -n`)

Level 2 — manual functional verification:

- [ ] I exercised the happy path, at least one edge case, and at least one failure case.
- [ ] I checked adjacent behaviour for regressions.
- [ ] User test document: `docs/user-tests/YYYY-MM-DD-<slug>.md` — or, if none is needed, why:
- [ ] I updated user and developer documentation where needed.

Level 3 — deployment verification (build, container, deployment, or release changes):

- [ ] Affected images build clean and the containers start and stay up.
- [ ] New environment variables are documented and present in every manifest that needs them.
- [ ] No secrets are baked into any image.

## Screenshots

Add screenshots or screen recordings for any user-visible change. Delete this section if it does not apply.

## Contribution readiness

- [ ] I identified new or changed dependencies.
- [ ] I identified data, provenance, privacy, security, and credential implications.
- [ ] I identified a maintenance owner or explained why this is not yet known.
- [ ] I did not include secrets, private keys, proprietary data, restricted data, or unauthorized third-party material.
- [ ] I have the right to submit this contribution under the repository license.

## Reviewer notes

Describe any limitations, follow-up work, compatibility concerns, or release notes needed.

State any known verification gaps: paths you could not exercise, environments you could not
reach, and anything a reviewer should re-check by hand.
