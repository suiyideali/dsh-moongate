# Release process

`main` is protected: every change lands through a pull request, and a pull request needs a review from `@mochazZZ` (the superagent) before it can merge.

## Rules

1. **No direct pushes to `main`.** Branch protection enforces pull requests, an approving review from the code owner, and the `test` CI check.
2. **Every pull request is reviewed by the superagent.** `.github/CODEOWNERS` and `.github/workflows/request-superagent-review.yml` request the review automatically; the CODEOWNERS entry is `@mochazZZ`.
3. **Tags are created after the PR merges, never by hand.** `.github/workflows/release.yml` runs on `main` after a merge and creates `v<package.json version>` plus a GitHub Release when that tag does not exist yet.

## How to cut a release

1. Branch from `main`: `git checkout -b release/vX.Y.Z`.
2. Bump `package.json` `version` to `X.Y.Z`.
3. Add release notes at `docs/releases/vX.Y.Z.md` (the workflow uses this file as the release body when present).
4. Open a pull request. The superagent reviews it automatically; wait for its approval and green CI.
5. Merge the pull request. The Release workflow creates and pushes the tag, then publishes the GitHub Release.
6. Do not run `git tag` or `gh release create` manually.

## History

- `v0.6.2` and earlier were published before this process existed (direct push + manual tag).
- From `v0.6.3` on, releases follow the pull-request + superagent-review flow above.
