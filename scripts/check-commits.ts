export const commitSubject =
  /^:[a-z0-9_+-]+: (?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)\([a-zA-Z0-9_./-]+\)!?: \S.+$/;

export function validCommitSubject(subject: string): boolean {
  return commitSubject.test(subject) && subject.length <= 100;
}
