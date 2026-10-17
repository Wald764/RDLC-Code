# Dependency and licensing review

## Adopted foundation dependencies

| Dependency                                            | License                            | Use / distribution                                                  |
| ----------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| saxes 6.0.0                                           | ISC                                | Bundled strict domain XML validation; full upstream notices shipped |
| xmlchars 2.2.0                                        | MIT                                | saxes transitive character validation                               |
| Angular 22.2.3                                        | MIT                                | Static AOT designer; generated full notices shipped                 |
| RxJS 7.8.2                                            | Apache-2.0                         | Angular peer; complete license included where bundled               |
| tslib 2.8.1                                           | 0BSD                               | Angular runtime helpers; license included where bundled             |
| esbuild                                               | MIT                                | Build-time only; approved binary-verification postinstall           |
| TypeScript / ESLint / Prettier / vsce / test-electron | Apache-2.0 / MIT / MIT / MIT / MIT | Development only                                                    |

Review sources are the exact installed package manifests and license files,
plus Angular's generated production license inventory. The saxes archive omits
LICENSE; its ISC text and inherited sax notices were reviewed at
<https://github.com/lddubeau/saxes/blob/v6.0.0/LICENSE>. ISC, MIT, Apache-2.0 and
0BSD permit this distribution with their respective notices retained; original
code remains MIT. Microsoft reference material is separately attributed,
read-only and excluded from packaging.

Only esbuild lifecycle scripts are approved. Optional native watcher/cache,
credential-store and signing builds are denied; they are not needed by this
unsigned, bundled scaffold. No dependency tree is shipped in the VSIX.

Initial-release review updated 2026-10-18: `THIRD_PARTY_NOTICES.md` now contains
the complete saxes 6.0.0 upstream license (including inherited notices) and
xmlchars 2.2.0 MIT license, checked against their versioned upstream sources.
The build copies this file into the extension and package verification requires
the exact reviewed bytes. Angular's generated full license inventory accompanies
the static bundle; the original project MIT license is packaged as LICENSE.txt.
There are no unresolved license incompatibilities in this reviewed inventory.
Build/dev tools and Microsoft reference material are not included in the VSIX.
