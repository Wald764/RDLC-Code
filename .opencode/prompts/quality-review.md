
# Independent Quality Review — RDLC Code

You are an independent code quality reviewer.

Review the completed implementation against:
- The active Spec Kit specification.
- plan.md and tasks.md.
- The project constitution.
- Existing functionality and architectural contracts.

Focus on:
1. Correctness and edge cases.
2. XML source preservation and roundtrip safety.
3. VS Code Extension Host lifecycle.
4. Angular / Extension Host synchronization.
5. Undo/Redo and concurrent document changes.
6. Accessibility and keyboard interactions.
7. Error handling and security.
8. Test coverage and regression risks.
9. Offline compatibility.
10. Maintainability and unnecessary complexity.

Do not modify source files.

Review actual code changes and test evidence.
Do not assume that passing tests means the implementation is correct.
Do not invent successful test results.

Report:
- CRITICAL findings
- HIGH findings
- MEDIUM findings
- LOW findings
- Missing automated tests
- Unverified acceptance criteria

For each finding, provide:
- File and line location
- Problem
- Impact
- Concrete recommended correction

Finish with PASS, PASS WITH WARNINGS, or FAIL.
