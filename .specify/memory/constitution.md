# RDLC Code Constitution

## Core Principles

### I. Open-Source, VS Code-Native Editing

The project MUST deliver an open-source RDLC report editor as a Visual Studio Code extension.
Core editing workflows MUST be usable within VS Code. Extension behavior MUST respect VS Code
document lifecycle conventions, including dirty state, save, undo/redo, and external changes.
Contributed code and dependencies MUST have licenses compatible with the project's chosen
open-source license; a license MUST be selected and recorded before public distribution.
The editor MUST NOT require proprietary authoring software for its core editing workflows.
This keeps the project accessible and its contributions reproducible.

### II. Specification-Driven RDLC Compatibility

The Microsoft MS-RDL specification vendored as Markdown under `vendor/` MUST be the primary
local reference for report-format semantics. Implementations and compatibility claims MUST
cite the relevant section identifiers and paths, and identify the report schema versions
they support. RDLC-specific behavior MUST be distinguished from general RDL behavior;
support for an RDL feature MUST NOT be inferred to imply RDLC runtime support.

Contributors MUST locate relevant sections through targeted searches of `vendor/README.md`,
`vendor/manifest.json`, or section filenames, then read only the needed sections. Extracted
Markdown can lose table or layout fidelity; unresolved ambiguities MUST be documented and
checked against the corresponding original source excerpt before asserting conformance.
Vendored specifications MUST retain provenance and applicable notices, and MUST NOT be
modified merely to make an implementation appear compliant.

### III. Lossless, Predictable Report Editing

Opening and saving a report without intentional edits MUST preserve its semantics.
Edits MUST preserve unrelated report content, XML namespaces, and unsupported elements and
attributes. An unsupported construct that cannot be preserved safely MUST produce an
actionable diagnostic and block the destructive save path rather than silently discard data.
Schema upgrades and other semantic conversions MUST be explicit user actions.

The serialized report MUST remain the durable source of truth. Any visual or structured
editing model MUST have a defined mapping to that report representation. Changes MUST be
scoped to the intended edit, with unrelated formatting preserved wherever feasible.
These rules protect existing reports as editor coverage grows incrementally.

### IV. Verifiable Behavior and Clear Boundaries

Report parsing, validation, and serialization MUST be separable from VS Code integration
and presentation so their behavior can be verified independently. New abstractions and
dependencies MUST address a demonstrated requirement rather than speculative future use.

Changes to parsing, serialization, schema handling, or editing semantics MUST include
focused verification using representative report fixtures and applicable specification
references. Round-trip and unsupported-content preservation checks MUST cover changes that
can alter saved reports. Integration checks MUST cover affected VS Code document lifecycle
behavior. Bug fixes in these areas MUST include a regression check that reproduces the fault.
Diagnostics MUST identify the affected construct and offer actionable context.

### V. Bounded Agent Context (NON-NEGOTIABLE)

Agents MUST NEVER load every repository file, every vendored specification file, or an
entire documentation corpus into context. This rule applies to direct reads, recursive
concatenation, tool output, and any delegated work. Splitting an exhaustive read across
multiple calls or agents does not satisfy this rule.

Before reading file contents, agents MUST identify the task's relevant paths or symbols
using directory metadata, filename discovery, indexes, or scoped search. Reads MUST use
explicit file selections and bounded line ranges where files are large. Search results
MUST be limited and narrowed by path, filename, section, or symbol before expanding scope.
Agents MUST expand context only when a concrete unresolved question requires it, and
retain concise findings with source paths rather than repeatedly loading source material.

Any future `AGENTS.md` instructions MUST preserve this prohibition and document the targeted
lookup workflow. Task plans and reviews MUST verify that reference discovery stays scoped.
This protects context quality in a repository containing over a thousand specification files.

### VI. Reproducible, Automated Releases

The project MUST use Semantic Versioning (SemVer). Git tags matching `vMAJOR.MINOR.PATCH`
MUST be the source of truth for extension versions. Every release-tag push MUST automatically
trigger the complete release process in GitHub Actions, with no manual approval or publishing
step after tag creation. Release automation MUST verify that the tag version equals the VS Code
extension package version and MUST fail before publication if they differ.

Release builds MUST use the exact commit identified by the tag and install dependencies from
the committed pnpm lockfile with frozen-lockfile enforcement. All required quality checks MUST
pass for that commit before any artifact is published. The pipeline MUST produce a versioned
VSIX and automatically create a GitHub Release with a generated changelog and that VSIX attached.
It MUST publish the same VSIX to the Visual Studio Marketplace and MUST also publish that same
VSIX to Open VSX when the required credentials are configured in GitHub Actions.

A published version MUST never be silently overwritten. A conflicting existing version or
release artifact MUST cause an explicit failure rather than replacement. These rules keep
published packages traceable to reviewed source and consistent across distribution channels.

## Project Constraints

- Feature specifications MUST define supported RDLC/RDL versions, supported constructs,
  unsupported behavior, and observable acceptance criteria before implementation.
- Report authoring support and report rendering or execution MUST have separately stated
  scope. Editing support MUST NOT be presented as proof of runtime rendering fidelity.
- Reports and workspace content MUST be treated as untrusted input. Merely opening or
  editing a report MUST NOT execute embedded code, evaluate arbitrary expressions, resolve
  external XML entities, access data sources, or fetch remote report resources.
- Extension features MUST respect VS Code Workspace Trust and webview isolation where
  applicable. Additional execution or network behavior MUST require an explicit feature
  contract and deliberate user action.
- Vendored reference material MUST remain distinguishable from project-owned source and
  retain its original attribution and licensing terms.
- The project MUST be hosted on GitHub and MUST use GitHub Actions exclusively for CI/CD.
- GitHub Actions workflows MUST use the minimum permissions required for each job. Publication
  secrets and credentials MUST be managed through GitHub Actions and MUST never be exposed in
  logs. Authentication MUST use methods officially supported by each publication platform.

## Development Workflow and Quality Gates

1. Scope the requested behavior and locate only the relevant source and reference sections.
2. Record compatibility assumptions, specification citations, acceptance criteria, and
   unsupported cases in the feature specification and implementation plan.
3. Check the plan against every applicable constitutional principle. Any proposed exception
   MUST be resolved through governance before implementation proceeds.
4. Implement the smallest coherent change and run the focused checks required by its impact,
   including available build, type, lint, and test checks applicable to changed components.
5. Review report preservation, VS Code lifecycle behavior, input handling, dependency
    licensing, and bounded agent context as applicable. Record check results and any remaining
    limitations in the change summary; limitations MUST NOT contradict mandatory principles.
6. Every pull request and every push to `main` MUST trigger lint, typecheck, tests, and build
   checks in GitHub Actions. Dependency installation MUST be reproducible from the committed
   pnpm lockfile using frozen-lockfile enforcement. Failed quality checks MUST block all
   artifact publication.
7. Every release-tag push MUST run the same quality gates for the tagged commit before
   publication and satisfy principle VI, including version consistency, identical VSIX
   distribution, automatic release notes, and protection against overwriting published versions.

## Governance

This constitution governs project specifications, plans, implementation, and agent guidance.
Reviews MUST check compliance with applicable principles and require correction of violations
before merge. More specific project guidance MAY refine these rules but MUST NOT weaken them.

Amendments MUST state the proposed change, its rationale, affected principles, compatibility
impact, and any required migration of existing guidance or implementation. A project
maintainer MUST approve amendments before adoption. Adopted amendments MUST update the
version and last-amended date and identify dependent guidance requiring follow-up.

Constitution versions follow semantic versioning: MAJOR for incompatible principle removals
or redefinitions; MINOR for new principles or materially expanded obligations; PATCH for
clarifications that do not change obligations. The ratification date remains the date of
initial adoption. The initial version is 1.0.0 because the prior file was an unratified scaffold.

**Version**: 1.1.0 | **Ratified**: 2026-10-15 | **Last Amended**: 2026-10-15
