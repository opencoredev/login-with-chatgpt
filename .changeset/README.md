# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

## Releasing, in one sentence

Every PR that changes a published package includes a **changeset** describing
the bump; merging PRs accumulates changesets; a bot opens a **"Version
packages"** PR; merging *that* PR publishes the new versions to npm.

## Adding a changeset to your PR

```bash
bun run changeset
```

Pick the packages you changed, choose `patch` / `minor` / `major`, and write a
one-line summary (it becomes the changelog entry). Commit the generated
`.changeset/*.md` file with your PR. Docs-only or example-only changes don't
need one.
