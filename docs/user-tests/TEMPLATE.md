<!--
  Copy this file to docs/user-tests/YYYY-MM-DD-<slug>.md and fill it in.
  Use the date you ran the test and a short hyphenated slug describing the change,
  e.g. docs/user-tests/2026-08-19-sam3-text-prompt-mode.md

  Delete every HTML comment before committing. Do not delete a section — if it does
  not apply, write "Not applicable" and one sentence saying why.

  The rules for writing these are in docs/TESTING.md, section "User test documentation".
  The short version: steps a stranger can follow, expected written before actual,
  failures recorded, public or synthetic data only, about a page, never edited later,
  and always say what you did not test.
-->

# User Test — <short title of the change>

<!--
  Commit SHA is the exact commit you tested, not the branch name. Get it with:
    git rev-parse --short HEAD
  Result is Pass, Pass with issues, or Fail. "Pass with issues" is a normal outcome.
-->

| Field | Value |
|---|---|
| Date | YYYY-MM-DD |
| Tester | Name |
| PR / issue | #NNN |
| Commit SHA | abc1234 |
| Result | Pass / Pass with issues / Fail |

## Environment

<!--
  Record only what is relevant to what you tested. Delete rows that do not apply,
  and add rows for anything else that mattered (image tag, cluster namespace,
  Tapis system, database host).
-->

| Item | Value |
|---|---|
| Where it ran | Local dev server / Docker / Kubernetes |
| Node.js | e.g. 20.x |
| Python | e.g. 3.12 |
| Browser | e.g. Chrome 140 |
| Image tag | e.g. smart-labeler:local, or n/a |
| Backend | e.g. local Flask on 11112 |

## Scope

<!--
  One or two sentences. What this document covers, and what it deliberately does not.
  If you are testing one step of the pipeline, say which step.
-->

## Preconditions

<!--
  Everything that had to be true before step 1. Accounts, permissions, data on a Tapis
  path, environment variables set, a running database, a completed prior pipeline step.
  Someone should be able to reproduce your run from this list alone.
  Never paste a credential or token here — name it, do not show it.
-->

- 
- 

## Test cases

<!--
  The happy path: the change doing what it was written to do, with ordinary inputs,
  exercised the way a user would exercise it.

  Steps must be specific enough for a stranger: name the page, the control, and the
  value entered. Write the Expected column before you run the step. Actual is what
  really happened, in the same level of detail — quote the real message or state.
-->

| # | Steps | Expected | Actual | Pass/Fail |
|---|---|---|---|---|
| 1 |  |  |  |  |
| 2 |  |  |  |  |

## Edge cases

<!--
  At least one. Empty input, boundary value, largest realistic input, slow response,
  a second concurrent user, an unusual but legal configuration.
-->

| # | Steps | Expected | Actual | Pass/Fail |
|---|---|---|---|---|
| 1 |  |  |  |  |

## Failure cases

<!--
  At least one. What a user sees when it goes wrong: invalid input, missing permission,
  unreachable Tapis system, rejected job, backend down.
  "It errors" is not a result — record the actual message, status code, or state.
-->

| # | Steps | Expected | Actual | Pass/Fail |
|---|---|---|---|---|
| 1 |  |  |  |  |

## Regression check

<!--
  The nearest behaviour you did NOT intend to change, exercised to confirm it still
  works. Name what you checked and what it did. If you touched the annotation canvas,
  this is saving and importing annotations. If you touched a Flask route, this is the
  neighbouring routes on the same blueprint.
-->

## Evidence

<!--
  Required for any visual change: before and after screenshots, same viewport, for
  every affected screen. Also useful: recordings, log excerpts, Tapis job IDs.
  Commit images alongside this file or attach them to the PR and link them here.
  Redact anything identifying a private system or a real user.
-->

## Issues found

<!--
  Anything that failed or looked wrong, with an issue link where one was filed.
  "None" is a valid entry — write it explicitly rather than leaving this blank.
-->

## Not tested

<!--
  What you did not exercise, and why. Do not leave this empty to look thorough —
  it is the most useful section in the document for the next person.
-->

- 
