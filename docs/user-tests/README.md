# User Tests

This directory is the test record for the repository.

There are no unit tests yet — see [Current position on unit tests](../TESTING.md#current-position-on-unit-tests)
for why, and for what will replace this arrangement later. Until that suite exists, CI
proves only that the code builds, parses, and contains no detectable secrets. Nothing
automated exercises a single code path. The evidence that a change actually works is the
manual verification recorded here, committed in the same pull request as the change.

## Adding one

1. Copy [TEMPLATE.md](./TEMPLATE.md) to `YYYY-MM-DD-<slug>.md` — the date you ran the
   test, then a short hyphenated slug describing the change. For example
   `2026-08-19-sam3-text-prompt-mode.md`.
2. Fill in every section, following the HTML comments in the template. Delete the
   comments before committing.
3. Commit it in the same pull request as the change, and link it from the pull request
   description.

The minimum bar for what to exercise — happy path, an edge case, a failure case, a
regression check on adjacent behaviour, and screenshots for visual changes — is in
[Level 2](../TESTING.md#level-2--manual-functional-verification).

## Rules

1. Write steps a stranger can follow. Name the page, the button, the field, and the value.
2. Record the expected result before running the step, not after.
3. Record failures. A document with no failures is usually a less careful one, not a
   better one.
4. Use public, synthetic, or de-identified data only. No credentials, tokens, restricted
   datasets, sensitive locations, or personal information — in the steps, the screenshots,
   or the logs.
5. Keep it to about a page. If it runs long, the change is probably too large for one
   document.
6. Never edit a past document. It records what was true on a specific commit on a specific
   date. Write a new one instead.
7. Always say what you did not test.

A pull request is never blocked for missing unit tests. It is blocked for a missing user
test document when the change is behavioural — see
[Merge criteria](../TESTING.md#merge-criteria).
