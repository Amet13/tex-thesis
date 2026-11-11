# Packaging

Every release attaches two generated files, built from that release's
`SHA256SUMS` by `packaging/generate.mjs`:

| File | For | Goes to |
| --- | --- | --- |
| `overfull.rb` | Homebrew (macOS arm64 and x64, Linux x64 and arm64) | `Formula/overfull.rb` in a tap repository named `homebrew-overfull` |
| `overfull.json` | Scoop (Windows x64) | `bucket/overfull.json` in a bucket repository named `scoop-overfull` |

The two repositories do not exist yet; the owner creates them. After that:

```bash
brew install amet13/overfull/overfull
scoop bucket add overfull https://github.com/amet13/scoop-overfull
scoop install overfull
```

To publish a release to them, download `overfull.rb` and `overfull.json` from
the release and commit them to the tap and the bucket. The Scoop manifest also
has `checkver` and `autoupdate`, so Scoop's own tooling can update it.

Generate them by hand:

```bash
node packaging/generate.mjs --version 3.1.0 --sums SHA256SUMS --out .
```

## npm

`packaging/npm.mjs` turns the release's `overfull.cjs` (the whole CLI in one file,
templates included, no dependencies) into the npm package `overfull`. The `npm`
job of `release.yml` publishes it with provenance when the repository has an
`NPM_TOKEN` secret, and skips with a notice otherwise.

```sh
node scripts/build-standalone.mjs
node packaging/npm.mjs --version 3.2.0 --out dist-npm
npm pack --dry-run ./dist-npm
```
