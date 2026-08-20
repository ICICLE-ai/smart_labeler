# Contributing

Thank you for helping improve this project. Contributions may include bug reports, documentation improvements, tests, examples, workflow or configuration artifacts, data/annotation schemas, and code changes.

## Before contributing

1. Read the README and relevant documentation.
2. Review open issues and pull requests to avoid duplicate work.
3. Do not submit credentials, private keys, proprietary data, restricted data, sensitive locations, personally identifiable information, or material that you are not authorized to share.
4. Use the issue templates to report a problem or propose a change before beginning a substantial contribution.

## Contribution pathway

The project welcomes contributions in increasing order of technical and maintenance responsibility:

1. Execute an example and report a problem.
2. Improve documentation or examples.
3. Add or improve a test.
4. Propose a workflow, configuration, annotation, or other non-code artifact.
5. Prepare a bounded code contribution.

For domain-specific contribution requirements, follow the repository's contribution specification in `docs/`.

## Pull requests

A pull request should:

- Reference the related issue or explain the problem being addressed.
- Be limited to one coherent change.
- Include or update tests when practical.
- Update documentation when user-visible behavior, interfaces, configuration, installation, or limitations change.
- Identify dependencies, data assumptions, security implications, and maintenance implications.
- Not include secrets, large unreviewed binary assets, private datasets, or unlicensed materials.

Maintainers may request changes, defer a contribution, or decline it when the change lacks a clear maintenance owner, conflicts with project scope, introduces unacceptable security or data risks, or cannot be reviewed with available resources.

## Testing

This repository has no unit tests yet. That is deliberate and is explained in
[docs/TESTING.md](docs/TESTING.md), which also defines what replaces them in the
meantime. In short:

1. Run the local pre-submit checks before you push — the same build and typecheck
   commands CI runs, in the same order.
2. Let CI run. The workflows in `.github/workflows/` build the packages and client, parse
   the server, validate YAML and shell scripts, check the required project files, and
   scan for secrets.
3. Exercise the change by hand: happy path, an edge case, a failure case, and a
   regression check on adjacent behaviour. Take screenshots for anything user-visible.
4. Write that up as `docs/user-tests/YYYY-MM-DD-<slug>.md` from
   [docs/user-tests/TEMPLATE.md](docs/user-tests/TEMPLATE.md) and commit it in the same
   pull request.

A pull request is not blocked for missing unit tests. It is blocked for a missing user
test document when the change is behavioural.

## License and contributor rights

By submitting a contribution, you represent that you have the right to submit it and that it may be distributed under this repository's license. If your employer, institution, funder, or data provider imposes restrictions, obtain authorization before contributing.

## Security issues

Do not report suspected vulnerabilities in a public issue. Follow `SECURITY.md`.
