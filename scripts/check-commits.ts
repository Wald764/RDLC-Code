export const commitSubject =
  /^:[a-z0-9_+-]+: (?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)\([a-zA-Z0-9_./-]+\)!?: \S.+$/;

export function validCommitSubject(subject: string): boolean {
  return (
    commitSubject.test(subject) &&
    subject.length <= 100 &&
    !/[\r\n]/.test(subject)
  );
}

export function parseCommit(
  message: string,
): { type: string; scope: string; breaking: boolean } | null {
  const [subject = '', separator, ...body] = message.split(/\r?\n/);
  if (
    !validCommitSubject(subject) ||
    (separator !== undefined && separator !== '')
  )
    return null;
  const match = /^:[a-z0-9_+-]+: ([a-z]+)\(([^)]+)\)(!)?: /.exec(subject)!;
  return {
    type: match[1]!,
    scope: match[2]!,
    breaking:
      !!match[3] || body.some((line) => /^BREAKING CHANGE: \S/.test(line)),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const title = process.env.PR_TITLE;
  if (title && !validCommitSubject(title))
    throw new Error('PR title must be a scoped gitmoji Conventional Commit');
  const base = process.env.COMMIT_BASE;
  const head = process.env.COMMIT_HEAD ?? 'HEAD';
  const range = base && !/^0+$/.test(base) ? `${base}..${head}` : head;
  if (base && !/^[a-f0-9]{40}$/.test(base))
    throw new Error('Invalid commit base');
  if (head !== 'HEAD' && !/^[a-f0-9]{40}$/.test(head))
    throw new Error('Invalid commit head');
  const subjects = execFileSync(
    'git',
    [
      'log',
      '--no-merges',
      '--format=%s',
      ...(range === head ? ['-1'] : []),
      range,
    ],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n');
  for (const subject of subjects)
    if (!validCommitSubject(subject))
      throw new Error(`Invalid commit subject: ${subject}`);
}
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
