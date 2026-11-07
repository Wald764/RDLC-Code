import { readdirSync, readFileSync, realpathSync } from 'node:fs';
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

const COVERAGE_DIR = 'tests/desktop';
const COVERAGE_FILE = /^coverage.*\.json$/;

/** Names of every `coverage*.json` in the directory, sorted for stable reports. */
export function coverageFiles(
  root: string,
  directory: string = COVERAGE_DIR,
): string[] {
  return readdirSync(resolve(root, directory))
    .filter((name) => COVERAGE_FILE.test(name))
    .sort();
}

function inside(base: string, path: string): boolean {
  const local = relative(base, path);
  return !(
    isAbsolute(local) ||
    local === '..' ||
    local.startsWith('../') ||
    local.startsWith('..\\')
  );
}

/** Each authority path (a string or a record of strings) must exist inside the candidate. */
function authorityReasons(base: string, authority: unknown): string[] {
  const paths =
    typeof authority === 'string'
      ? [authority]
      : authority && typeof authority === 'object'
        ? Object.values(authority)
        : [];
  if (
    !paths.length ||
    paths.some((entry) => typeof entry !== 'string' || !entry)
  )
    return ['authority is missing or not made of paths'];
  const reasons: string[] = [];
  for (const entry of paths as string[]) {
    try {
      if (!inside(base, realpathSync(resolve(base, entry))))
        reasons.push(`authority ${entry} escapes the candidate`);
    } catch (error) {
      reasons.push(
        `authority ${entry} cannot resolve: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return reasons;
}

/**
 * Checks every `coverage*.json`: each file is judged by its own `authority`
 * and its own rows, and every reason is prefixed with the file it came from.
 * No coverage file at all is a reason, never a silent pass.
 */
export function coverageFileReasons(
  root: string,
  directory: string = COVERAGE_DIR,
): string[] {
  const base = realpathSync(root);
  let names: string[];
  try {
    names = coverageFiles(root, directory);
  } catch (error) {
    return [
      `cannot list ${directory}: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  if (!names.length) return [`${directory}: no coverage*.json file found`];
  const reasons: string[] = [];
  for (const name of names) {
    let coverage: CoverageRef & { authority?: unknown };
    try {
      coverage = JSON.parse(
        readFileSync(resolve(root, directory, name), 'utf8'),
      ) as CoverageRef & { authority?: unknown };
      if (!coverage || !Array.isArray(coverage.rows))
        throw new Error('rows must be an array');
    } catch (error) {
      reasons.push(
        `${name}: cannot load: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    reasons.push(
      ...[
        ...authorityReasons(base, coverage.authority),
        ...coverageAssertionReasons(root, coverage),
      ].map((reason) => `${name}: ${reason}`),
    );
  }
  return reasons;
}
