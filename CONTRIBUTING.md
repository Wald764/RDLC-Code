# Contributing

## Toolchain and setup

Use the exact Node version in `.node-version` and pnpm version in root
`package.json.packageManager`. Current pins are Node 24.22.0 and pnpm 11.28.2.
No backend, database or external report runtime is required.

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:roundtrip
pnpm test:compatibility
pnpm test:acceptance
pnpm test:release
pnpm build
pnpm package
pnpm test:vscode
pnpm test:package
```

`test:acceptance` tests measurement-record validation; it does not collect or
claim actual SC-004 timings. `test:release` tests release guards without accounts
or publication. The build compiles test tooling for both commands. Scripts that
compile domain tests also refresh `dist/`; build again before Electron tests.
For offline developer setup, prepopulate the pnpm store and use
`pnpm install --offline --frozen-lockfile`; cache the official VS Code harness
before disconnecting. Linux Electron checks need a display, for example
`xvfb-run -a pnpm test:package`. Set `VSCODE_VERSION=1.142.0` to test the minimum;
the default is stable. Installed VSIX tests use an isolated profile.

Follow the [quickstart scenarios](specs/001-rdlc-vscode-editor/quickstart.md)
and [acceptance measurement procedure](docs/validation/acceptance.md). Record
actual tool/OS/consumer versions and unrun checks honestly. The historical
quickstart's design-only status and proposed 1.110 minimum are superseded by
the implementation and tested 1.142.0 minimum documented here.

## Structure and change rules

- `apps/designer`: static Angular UI; `apps/vscode-extension`: VS Code services.
- `packages`: immutable model plus parser, serializer, validation, expressions
  and pure design geometry. Respect import boundaries enforced by ESLint.
- `scripts`: TypeScript-only build/release tooling. No new runtime or framework
  is needed for a small helper; use existing tools and Node APIs.
- Keep source authoritative. Test minimal edit footprints, unsupported-content
  preservation and native lifecycle behavior when changing report editing.
- Discover MS-RDL references through `vendor/README.md`, `vendor/manifest.json`
  or section filenames, then read only the necessary sections. Never read the
  whole corpus or edit `vendor/` to satisfy a test. Cite version-specific paths.
- Write documentation in English. Preserve dependency notices and review licenses
  before shipping new dependencies.

Commit subjects and PR titles use `:gitmoji: type(scope): description`, with a
short English imperative description and a shortcode rather than a Unicode
emoji. Example: `:bug: fix(parser): Preserve namespace bindings`. Conventional
breaking `!` and `BREAKING CHANGE:` footers are supported. Run
`pnpm check:commits`; CI validates PR titles and applicable non-merge subjects.
Configure squash merges to retain the validated PR title.

## Releases

See [docs/releases.md](docs/releases.md). Task implementation does not authorize
tag creation or publication. Independent contributor reproduction is tracked in
[contributor-build evidence](docs/validation/contributor-build.md).
