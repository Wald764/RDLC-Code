# Contributing

## Toolchain and setup

Use the exact Node version in `.node-version` and pnpm version in root
`package.json.packageManager`. Current pins are Node 24.22.0 and pnpm 11.28.2.
No backend, database or external report runtime is required.

```sh
pnpm install --frozen-lockfile
pnpm qa:quick
```

Local QA is targeted: run only what is relevant to your change. The canonical
policy, classification and outcomes are in
[docs/validation/qa-policy.md](docs/validation/qa-policy.md). Do not run the complete
suite after every change; GitHub Actions runs the full regression and Desktop matrix
on every pull request.

| Command                       | Use                                                                                                                                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm qa:quick`               | Default. Affected workspaces only, plus prettier/eslint on changed files. No VS Code, packaging or Desktop E2E.                                                                                                                                     |
| `pnpm qa:integration`         | Coherent batch of changes: full format, lint, typecheck, all node suites and build; one extension-host VS Code run (`test:vscode`) only if the extension or a package it depends on is affected. Never Desktop E2E, visual tests or packaging.      |
| `pnpm qa:release`             | Critical release checks: release tests, build, package (verifies the VSIX) and static package tests; `--tag vX.Y.Z` also validates that tag. It does not run `validate-release-config`, which needs the publishing environment and runs in CI only. |
| `pnpm qa:full --confirm-full` | Complete CI-equivalent regression, including Desktop E2E and visual tests. Only on explicit request; it takes well over an hour.                                                                                                                    |

Every command accepts `--plan` to print what it would run without running it.
Work on a feature branch and open a pull request: `main` is protected and requires
the `Required checks` status.

`test:acceptance` tests measurement-record validation; it does not collect or
claim actual SC-004 timings. `test:release` tests release guards without accounts
or publication. The build compiles test tooling for both commands. Scripts that
compile domain tests also refresh `dist/`; build again before Electron tests.
For offline developer setup, prepopulate the pnpm store and use
`pnpm install --offline --frozen-lockfile`; cache the official VS Code harness
before disconnecting. Linux Electron checks need a display, for example
`xvfb-run -a pnpm test:package`. Set `VSCODE_VERSION=1.142.0` to test the minimum;
the default is stable. Installed VSIX tests use an isolated profile.

### Native sidebar Desktop checks

`tests/desktop/coverage.spec.ts` checks that every coverage reference names a
nonempty executable test declaration. Comments, skipped tests and placeholder
IDs are not assertions. Keep a row's independent oracle and fixture references
when correcting its test titles; resolving a title is not evidence that it passed.

Feature 005 adds `pnpm test:e2e` and `pnpm test:visual`. Build before running them.
They fail closed for missing mandatory suites, references, observer capabilities
or same-candidate evidence; in the QA policy this maps to a feature that cannot be
declared FULLY VALIDATED, while only critical failures block a merge or release.
A successful targeted test does not certify the full feature. Baseline requirements and the six-target matrix are described in the
[native sidebar quickstart](specs/005-native-sidebar-integration/quickstart.md).

For a focused functional reproduction after `pnpm build` and `pnpm package`:

```sh
pnpm exec playwright test --config tests/desktop/playwright.config.ts workspace.spec.ts data.spec.ts components.spec.ts structure.spec.ts
```

Set `RDLC_DESKTOP_PACKAGED=true` to test the installed VSIX and
`VSCODE_VERSION=1.142.0` or the desired stable version explicitly. The tests launch
real Desktop profiles and use native input; screenshots and timing samples are
diagnostics until all required comparison/coverage gates pass. The Structure
test retains its 95/100 selections within 200ms assertion, sampling alternating
native/canvas operations spaced past the host's 200ms TreeView event
coalescing. The separate native-drag probe records unavailable custom-MIME
delivery on Windows; native activation and compact HTML drag remain independent
functional requirements.

The full installed run is CI-only by default: it takes well over an hour, opens
real windows that take focus and is timing-sensitive, so run it locally only when
explicitly requested and avoid using the machine meanwhile. CI splits
it into parallel jobs: set `RDLC_DESKTOP_GROUP` to `core`, `authoring` or
`context` to run one disjoint slice locally; unset runs every suite.

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
