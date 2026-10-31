import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

/**
 * CI pre-download of the VS Code build the Desktop and extension-host tests
 * run, so a transient network failure on the runner (ETIMEDOUT against
 * update.code.visualstudio.com) is retried here instead of failing a journey.
 *
 * It uses the same call as tests/desktop/driver.ts and tests/vscode, with the
 * same default cache (`<cwd>/.vscode-test`, so run it from the repository
 * root). `stable` is resolved once here; the tests resolve it again, and when
 * that lookup fails @vscode/test-electron falls back to the newest install in
 * the cache. A pinned version that is already installed is used without any
 * network call.
 */

export const DOWNLOAD_ATTEMPTS = 3;
export const BACKOFF_MS = [5_000, 15_000] as const;

export interface RetryOptions {
  readonly attempts?: number;
  readonly backoffMs?: readonly number[];
  readonly sleep?: (ms: number) => Promise<void>;
  readonly log?: (message: string) => void;
}

/** Runs `task` up to `attempts` times, waiting the backoff between failures. */
export async function withRetries<T>(
  task: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? DOWNLOAD_ATTEMPTS;
  const backoff = options.backoffMs ?? BACKOFF_MS;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const log = options.log ?? ((message: string) => console.warn(message));
  for (let attempt = 1; ; attempt++) {
    try {
      return await task(attempt);
    } catch (error) {
      if (attempt >= attempts) throw error;
      const wait = backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0;
      log(
        `Attempt ${attempt}/${attempts} failed (${error instanceof Error ? error.message : String(error)}); retrying in ${wait} ms.`,
      );
      await sleep(wait);
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const version = process.argv[2] || process.env['VSCODE_VERSION'] || 'stable';
  try {
    const executable = await withRetries(() => downloadAndUnzipVSCode(version));
    console.log(`VS Code ${version} ready: ${executable}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
