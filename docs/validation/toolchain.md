# Toolchain validation (V1)

Checked on 2026-10-15 against published npm metadata and the Node distribution index.

| Component                                    | Exact selection       | Compatibility evidence                                 |
| -------------------------------------------- | --------------------- | ------------------------------------------------------ |
| Angular core/compiler/compiler-cli/CLI/build | 22.2.3                | Published; Node `^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0` |
| TypeScript                                   | 6.0.3                 | Published; compiler-cli/build require `>=6.0 <6.1`     |
| Node                                         | 24.22.0 LTS (Krypton) | Published 2026-10-14; within Angular's Node 24 range   |
| pnpm                                         | 11.28.2               | Published; Node `>=22.13`                              |
| RxJS                                         | 7.8.2                 | Angular core accepts `^6.5.3 \|\| ^7.4.0`              |

Sources: <https://registry.npmjs.org/@angular/core/22.2.3>,
<https://registry.npmjs.org/@angular/compiler-cli/22.2.3>,
<https://registry.npmjs.org/@angular/build/22.2.3>,
<https://registry.npmjs.org/@angular/cli/22.2.3>,
<https://registry.npmjs.org/typescript/6.0.3>,
<https://registry.npmjs.org/pnpm/11.28.2>,
<https://nodejs.org/dist/index.json>.

Build Node is separate from the VS Code extension-host runtime. VS Code 1.110
remains an unverified minimum until the Electron matrix runs successfully.
The workstation initially supplies Node 22.22.3; local verification uses an isolated
Node 24.22.0 executable, checked against official SHASUMS256.txt (win-x64/node.exe:
`ba93f9a70bd86fce3ebbb39ec758501458453467aa92a34a0a3602d1e3fc2b9c`).
