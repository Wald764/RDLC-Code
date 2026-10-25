import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import ts from 'typescript';
import type { CoverageRef } from './evidence.js';

/** Static discovery proves a reference names a declared test, never that it ran or passed. */
export function coverageAssertionReasons(
  root: string,
  coverage: CoverageRef,
): string[] {
  const reasons: string[] = [];
  const titlesByFile = new Map<string, ReadonlySet<string>>();
  const base = realpathSync(root);
  for (const row of coverage.rows) {
    if (!row.tests.length)
      reasons.push(`${row.id}: no executable assertions declared`);
    for (const reference of row.tests) {
      const [file, title, extra] = reference.split('::');
      if (
        !file ||
        !title ||
        extra !== undefined ||
        !/\.(?:test|spec)\.ts$/.test(file)
      ) {
        reasons.push(`${row.id}: invalid assertion reference ${reference}`);
        continue;
      }
      try {
        let titles = titlesByFile.get(file);
        if (!titles) {
          const path = realpathSync(resolve(base, file));
          const local = relative(base, path);
          if (
            isAbsolute(local) ||
            local === '..' ||
            local.startsWith('../') ||
            local.startsWith('..\\')
          )
            throw new Error('assertion path escapes the candidate');
          const source = ts.createSourceFile(
            path,
            readFileSync(path, 'utf8'),
            ts.ScriptTarget.Latest,
            true,
          );
          const found = new Set<string>();
          const visit = (node: ts.Node): void => {
            if (
              /^tests\/vscode\/[^/]+\.test\.ts$/.test(file) &&
              ts.isFunctionDeclaration(node) &&
              node.name?.text === 'run' &&
              node.modifiers?.some(
                (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
              ) &&
              node.body?.statements.length
            )
              found.add('run');
            if (
              ts.isCallExpression(node) &&
              ts.isPropertyAccessExpression(node.expression) &&
              ['skip', 'todo'].includes(node.expression.name.text)
            )
              return;
            if (
              ts.isCallExpression(node) &&
              ts.isIdentifier(node.expression) &&
              ['test', 'it'].includes(node.expression.text)
            ) {
              const name = node.arguments[0];
              const body = node.arguments.at(-1);
              const options =
                node.arguments.length > 2 ? node.arguments[1] : undefined;
              const skipped =
                options &&
                ts.isObjectLiteralExpression(options) &&
                options.properties.some(
                  (property) =>
                    ts.isPropertyAssignment(property) &&
                    ['skip', 'todo'].includes(
                      ts.isIdentifier(property.name) ||
                        ts.isStringLiteral(property.name)
                        ? property.name.text
                        : property.name.getText(source),
                    ) &&
                    property.initializer.kind !== ts.SyntaxKind.FalseKeyword,
                );
              if (
                name &&
                ts.isStringLiteralLike(name) &&
                body &&
                !skipped &&
                (ts.isArrowFunction(body) || ts.isFunctionExpression(body)) &&
                (!ts.isBlock(body.body) || body.body.statements.length > 0)
              )
                found.add(name.text);
            }
            ts.forEachChild(node, visit);
          };
          visit(source);
          titles = found;
          titlesByFile.set(file, titles);
        }
        if (!titles.has(title))
          reasons.push(`${row.id}: no executable test titled ${reference}`);
      } catch (error) {
        reasons.push(
          `${row.id}: cannot resolve ${reference}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  return reasons;
}
