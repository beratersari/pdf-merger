# PDF Merger

Local Windows PDF merger. PDFs stay in the browser tab.

## Branches

- `main` is the published line.
- `develop` is where new work starts. Branch from `develop`.

Update `main` when the work on `develop` is ready to publish. Do not force-push `main`.

## Commits

Make atomic commits. One commit is one logical change.

- Use `type: imperative subject` with `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `build`, or `ci`.
- Keep the subject to 72 characters or fewer, with no trailing period.
- Use the body for why. Wrap it at 72 characters. Do not list files.
- Keep a behavior change in the same commit as the tests that lock it.
- Do not mix unrelated work, and do not commit secrets or `node_modules`.
