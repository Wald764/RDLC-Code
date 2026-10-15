# Dependency and licensing review

## Adopted foundation dependencies

| Dependency                                            | License                            | Use / distribution                                                  |
| ----------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| saxes 6.0.0                                           | ISC                                | Strict domain XML validation; not yet imported by the scaffold host |
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

Distribution blockers: final bundled parser license texts must be added when
the host starts importing parser code; complete final shipped dependency inventory
and package-content audit belong to T064/T079. No public-distribution approval
is implied by the foundation review.
