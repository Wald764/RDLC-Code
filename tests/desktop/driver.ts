import {
  _electron as electron,
  chromium,
  type Browser,
  type BrowserContext,
  type ElectronApplication,
  type Frame,
  type Locator,
  type Page,
} from 'playwright';
import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
} from '@vscode/test-electron';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { arch, platform, release, tmpdir } from 'node:os';

/** Frozen launch contract used by the Desktop runner and specs. */
export interface DesktopLaunchOptions {
  readonly root: string;
  readonly version: string;
  readonly packaged: boolean;
  readonly artifactDir: string;
  readonly vsixPath?: string;
  /** Load only the test observer/probe extension alongside the installed candidate. */
  readonly testHarness?: boolean;
  /** Folder opened in the window; defaults to the repository root. */
  readonly workspaceDir?: string;
  /** Node inspector port for the extension host (test delay hooks only). */
  readonly inspectExtensions?: number;
}

export interface DesktopPaths {
  readonly profileDir: string;
  readonly extensionsDir: string;
  readonly workspaceDir: string;
}

export interface DesktopIdentity {
  readonly processId: number;
  readonly version: string;
  readonly executablePath: string;
  readonly executableSha256: string;
  readonly transport: 'electron' | 'cdp';
  [key: string]: unknown;
}

export interface DesktopDriver {
  readonly page: Page;
  readonly context: BrowserContext;
  readonly identity: DesktopIdentity;
  readonly profileDir: string;
  designerFrame(): Promise<Frame>;
  command(id: string): Promise<void>;
  capture(name: string): Promise<void>;
  close(): Promise<void>;
}

const LAUNCH_TIMEOUT = 60_000;
const WINDOW_TIMEOUT = 60_000;
const FRAME_TIMEOUT = 60_000;
const COMMAND_TIMEOUT = 30_000;
const PALETTE_ATTEMPTS = 3;
const PALETTE_STEP_TIMEOUT = 10_000;
const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CAPTURE_TIMEOUT = 30_000;
const TRACE_TIMEOUT = 15_000;
// The 100-switch journey exports over 400MB; allow its archive to finish before closing Electron.
const TRACE_STOP_TIMEOUT = 120_000;
const CLOSE_TIMEOUT = 15_000;
const PROFILE_REMOVE_TIMEOUT = 15_000;
const INSTALL_TIMEOUT = 120_000;

const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeSegment(value: string): string {
  return (
    value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'unknown'
  );
}

function defaultVsixPath(root: string): string {
  const manifest = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8'),
  ) as { version?: unknown };
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
    throw new Error(
      `Cannot derive the packaged Desktop VSIX: ${join(root, 'package.json')} has no version`,
    );
  }
  return join(root, 'dist', `rdlc-code-${manifest.version}.vsix`);
}

export function validateDesktopOptions(
  options: DesktopLaunchOptions,
): DesktopLaunchOptions {
  const root = resolve(options.root);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Desktop root is not a directory: ${root}`);
  }
  const workspaceDir = options.workspaceDir
    ? { workspaceDir: resolve(options.workspaceDir) }
    : {};
  if (
    workspaceDir.workspaceDir &&
    (!existsSync(workspaceDir.workspaceDir) ||
      !statSync(workspaceDir.workspaceDir).isDirectory())
  ) {
    throw new Error(
      `Desktop workspace is not a directory: ${workspaceDir.workspaceDir}`,
    );
  }
  if (!options.version.trim()) {
    throw new Error('Desktop version must not be empty');
  }
  if (!options.artifactDir.trim()) {
    throw new Error('Desktop artifact directory must not be empty');
  }
  if (options.packaged) {
    const vsixPath = resolve(options.vsixPath ?? defaultVsixPath(root));
    if (!existsSync(vsixPath) || !statSync(vsixPath).isFile()) {
      throw new Error(`Packaged Desktop VSIX is not a file: ${vsixPath}`);
    }
    return {
      root,
      version: options.version.trim(),
      packaged: true,
      artifactDir: resolve(options.artifactDir),
      vsixPath,
      ...workspaceDir,
      ...(options.testHarness ? { testHarness: true } : {}),
      ...inspector(options),
    };
  }
  if (options.vsixPath) {
    throw new Error('Development Desktop launch must not install a VSIX');
  }
  return {
    root,
    version: options.version.trim(),
    packaged: false,
    artifactDir: resolve(options.artifactDir),
    ...workspaceDir,
    ...(options.testHarness ? { testHarness: true } : {}),
    ...inspector(options),
  };
}

function inspector(
  options: DesktopLaunchOptions,
): Pick<DesktopLaunchOptions, 'inspectExtensions'> {
  const port = options.inspectExtensions;
  if (port === undefined) return {};
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error(`Extension inspector port is invalid: ${port}`);
  return { inspectExtensions: port };
}

/** Workbench content size the journeys are written against. */
const WINDOW_CONTENT_SIZE = { width: 1440, height: 900 } as const;

/**
 * Smallest content size the journeys are valid in. A host whose screen cannot
 * hold the full size (a macOS runner clamps windows to the display work area)
 * runs at the largest size that fits, recorded and logged; below this floor
 * the launch fails instead of running a cramped, misleading session.
 */
const MIN_WINDOW_CONTENT_SIZE = { width: 1280, height: 600 } as const;

export interface WindowSize {
  readonly width: number;
  readonly height: number;
}

export interface WindowGeometry {
  /** Size the journeys are written against. */
  readonly desired: WindowSize;
  /** Content size requested after fitting the display work area. */
  readonly requested: WindowSize;
  /** Content size the window actually has once sized. */
  readonly content: WindowSize;
  /** Work area of the display holding the window. */
  readonly workArea: WindowSize;
  /** `full` meets the desired size; `constrained` runs smaller but valid. */
  readonly status: 'full' | 'constrained';
}

/** Recorded when the window geometry could not be measured at all. */
export interface UnknownWindowGeometry {
  readonly status: 'unknown';
  readonly reason: string;
}

/** Log and record that geometry is unknown instead of silently skipping it. */
function unknownWindowGeometry(reason: string): UnknownWindowGeometry {
  console.warn(`Desktop window geometry is unknown: ${reason}`);
  return { status: 'unknown', reason };
}

/** Size to request: the desired content size, reduced to what the display holds. */
export function fitContentSize(
  desired: WindowSize,
  workArea: WindowSize,
  frame: WindowSize,
): WindowSize {
  return {
    width: Math.max(1, Math.min(desired.width, workArea.width - frame.width)),
    height: Math.max(
      1,
      Math.min(desired.height, workArea.height - frame.height),
    ),
  };
}

/**
 * Judge the window once sized. Throws a descriptive error when the content is
 * below the supported floor; never lets a cramped window pass unnoticed.
 */
export function assessWindowGeometry(
  measured: {
    readonly requested: WindowSize;
    readonly content: WindowSize;
    readonly workArea: WindowSize;
  },
  desired: WindowSize = WINDOW_CONTENT_SIZE,
  minimum: WindowSize = MIN_WINDOW_CONTENT_SIZE,
): WindowGeometry {
  const { content, workArea } = measured;
  if (content.width < minimum.width || content.height < minimum.height)
    throw new Error(
      `Desktop window content is ${content.width}x${content.height}, below the ` +
        `${minimum.width}x${minimum.height} minimum (wanted ${desired.width}x` +
        `${desired.height}; display work area ${workArea.width}x${workArea.height}). ` +
        'Enlarge the display, hide the Dock or taskbar, or run on a larger screen.',
    );
  return {
    desired,
    ...measured,
    status:
      content.width >= desired.width && content.height >= desired.height
        ? 'full'
        : 'constrained',
  };
}

/** Unix socket paths are limited to 104 bytes on macOS (108 on Linux). */
const SOCKET_PATH_LIMIT = 103;

export function desktopPaths(
  options: DesktopLaunchOptions,
  id = `${process.pid}-${randomUUID()}`,
  os: NodeJS.Platform = platform(),
  temp: string = tmpdir(),
): DesktopPaths {
  const name = `${options.packaged ? 'packaged' : 'development'}-${safeSegment(options.version)}-${id}`;
  let profileDir = join(
    resolve(options.root),
    '.vscode-test',
    'desktop-profiles',
    name,
  );
  // VS Code listens on `<user-data-dir>/<version>-main.sock`; a deep checkout
  // overflows the socket limit and Desktop never starts, so use a short dir.
  const socket = join(profileDir, `${options.version.slice(0, 4)}-main.sock`);
  if (os !== 'win32' && Buffer.byteLength(socket) > SOCKET_PATH_LIMIT)
    profileDir = join(
      temp,
      `rdlc-${createHash('sha256').update(name).digest('hex').slice(0, 12)}`,
    );
  return {
    profileDir,
    extensionsDir: join(profileDir, 'extensions'),
    workspaceDir: resolve(options.workspaceDir ?? options.root),
  };
}

/**
 * Built-in extensions that reach the network or probe the machine in the
 * background (Copilot Chat, sign-in providers, tunnels, GitHub, npm registry,
 * JS/TS chat features, the debugger companion, terminal completions). None is needed by an RDLC
 * journey, and the host observers must only see traffic the product causes.
 */
export const DISABLED_BUILTIN_EXTENSIONS: readonly string[] = [
  'GitHub.copilot-chat',
  'TypeScriptTeam.jsts-chat-features',
  'vscode.github',
  'vscode.github-authentication',
  'vscode.microsoft-authentication',
  'vscode.tunnel-forwarding',
  'vscode.npm',
  'ms-vscode.js-debug-companion',
  // Probes every PATH entry (docker, mvn, gradle...) to build completions.
  'vscode.terminal-suggest',
];

export function desktopLaunchArgs(
  options: DesktopLaunchOptions,
  paths: DesktopPaths,
): string[] {
  const root = resolve(options.root);
  const args = [
    `--user-data-dir=${paths.profileDir}`,
    `--extensions-dir=${paths.extensionsDir}`,
    // Trusted folders live in the shared data dir (the user's home by default);
    // keep it disposable so trust starts empty and a grant never leaks out.
    `--shared-data-dir=${join(paths.profileDir, 'shared-data')}`,
    '--skip-welcome',
    '--skip-release-notes',
    '--no-cached-data',
    '--disable-gpu',
    '--no-sandbox',
    ...DISABLED_BUILTIN_EXTENSIONS.map((id) => `--disable-extension=${id}`),
  ];
  // Workspace trust stays native so trusted and restricted runs remain real.
  if (!options.packaged) {
    args.push(
      `--extensionDevelopmentPath=${join(root, 'apps', 'vscode-extension')}`,
    );
  }
  if (!options.packaged || options.testHarness)
    args.push(
      `--extensionDevelopmentPath=${join(root, 'tests', 'vscode', 'harness')}`,
    );
  if (options.inspectExtensions !== undefined)
    args.push(`--inspect-extensions=${options.inspectExtensions}`);
  args.push(paths.workspaceDir);
  return args;
}

const TRUST_PROBE_COMMAND = 'RDLC Test: Report Workspace Trust';

/** File the harness writes `vscode.workspace.isTrusted` to, inside its own global storage. */
export function trustProbePath(profileDir: string): string {
  return join(
    profileDir,
    'User',
    'globalStorage',
    'rdlc-tests.rdlc-test-harness',
    'workspace-trust.json',
  );
}

/** Strictly parse the harness record; anything but a boolean is not evidence. */
export function parseTrustProbe(text: string): boolean {
  const value = (JSON.parse(text) as { isTrusted?: unknown }).isTrusted;
  if (typeof value !== 'boolean')
    throw new Error('The trust probe did not record a boolean isTrusted.');
  return value;
}

/** Authoritative trust state: the public `vscode.workspace.isTrusted`, via the test harness. */
export async function readWorkspaceTrust(
  driver: Pick<DesktopDriver, 'profileDir' | 'command'>,
): Promise<boolean> {
  const file = trustProbePath(driver.profileDir);
  rmSync(file, { force: true });
  await driver.command(TRUST_PROBE_COMMAND);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (existsSync(file)) return parseTrustProbe(readFileSync(file, 'utf8'));
    await delay(100);
  }
  throw new Error('The test harness did not report workspace trust.');
}

const OPEN_FILE_COMMAND = 'RDLC Test: Open Requested File';

const harnessStorage = (profileDir: string): string =>
  join(profileDir, 'User', 'globalStorage', 'rdlc-tests.rdlc-test-harness');

/** Request the driver writes for the harness' open-file command. */
export function openRequestPath(profileDir: string): string {
  return join(harnessStorage(profileDir), 'open-request.json');
}

/** Outcome the harness' open-file command writes back. */
export function openResultPath(profileDir: string): string {
  return join(harnessStorage(profileDir), 'open-result.json');
}

/** A harness outcome that is final: the file was not opened. */
class OpenFailure extends Error {}

/**
 * Strictly parse the outcome: `ok: false` is final whatever its id (an
 * unreadable request carries none); `ok: true` is evidence only for this id.
 */
export function parseOpenResult(text: string, id: string): string {
  const result = JSON.parse(text) as {
    id?: unknown;
    ok?: unknown;
    opened?: unknown;
    error?: unknown;
  };
  if (result.ok === false)
    throw new OpenFailure(
      `The test harness could not open the file: ${String(result.error ?? 'unknown error')}`,
    );
  if (result.id !== id)
    throw new Error('The test harness answered a different open request.');
  if (result.ok !== true)
    throw new Error('The test harness result has no boolean ok.');
  return String(result.opened);
}

/**
 * Open a workspace file in the active editor group through the harness
 * (`vscode.open`, or `vscode.openWith` when `viewType` is given), instead of
 * Quick Open file search. The palette only triggers a fixed, unique command;
 * the path travels through a request file and the harness confirms the active
 * tab shows that file (and that editor type when requested).
 */
export async function openWorkspaceFile(
  driver: Pick<DesktopDriver, 'profileDir' | 'command'>,
  path: string,
  viewType?: string,
  timeoutMs = 15_000,
): Promise<void> {
  if (!isAbsolute(path))
    throw new Error(`Opening ${path}: the path must be absolute.`);
  const id = randomUUID();
  const request = openRequestPath(driver.profileDir);
  const result = openResultPath(driver.profileDir);
  mkdirSync(dirname(request), { recursive: true });
  rmSync(result, { force: true });
  writeFileSync(
    request,
    JSON.stringify({ id, path, ...(viewType ? { viewType } : {}) }),
  );
  await driver.command(OPEN_FILE_COMMAND);
  const deadline = Date.now() + timeoutMs;
  let last: unknown = 'no result file appeared';
  while (Date.now() < deadline) {
    try {
      parseOpenResult(readFileSync(result, 'utf8'), id);
      return;
    } catch (error) {
      if (error instanceof OpenFailure)
        throw new Error(`Opening ${path}: ${error.message}`, { cause: error });
      // Missing, half-written (or briefly locked) and stale results are
      // retried until the deadline; the last cause names the timeout.
      last = error;
    }
    await delay(100);
  }
  throw new Error(
    `The test harness did not report opening ${path}: ${last instanceof Error ? last.message : String(last)}`,
    { cause: last },
  );
}

export const TRUST_COMMAND = 'Workspaces: Manage Workspace Trust';
export const TRUSTED_TEXT =
  /You trust the authors of the files in the current (?:workspace|folder|window)|You trust this (?:workspace|folder|window)/i;

/**
 * Workbench commands (notably Workspace Trust) register shortly after the window
 * appears, so a single early palette lookup would report a false "unavailable".
 */
export async function commandAvailable(
  page: Page,
  id: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt++) {
    if (await commandListed(page, id)) return true;
    await page.waitForTimeout(2_000);
  }
  return false;
}

async function commandListed(page: Page, id: string): Promise<boolean> {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.bringToFront();
  await page
    .locator('.quick-input-widget:visible')
    .waitFor({ state: 'hidden', timeout: 5_000 })
    .catch(() => {});
  await page.keyboard.press(`${modifier}+Shift+P`);
  const input = page.locator(
    '.quick-input-widget:visible .quick-input-box input',
  );
  await input.waitFor({ state: 'visible', timeout: 15_000 });
  await page.keyboard.type(id, { delay: 10 });
  const available = await page
    .locator('.quick-input-widget:visible .quick-input-list .monaco-list-row')
    .filter({ hasText: id })
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  await withTimeout(
    page.keyboard.press('Escape'),
    COMMAND_TIMEOUT,
    'Command palette dismissal',
  );
  return available;
}

/** The Workspace Trust editor floats over the workbench and would swallow a journey's keystrokes. */
export async function closeTrustEditor(driver: DesktopDriver): Promise<void> {
  await driver.command('View: Close Editor');
  await driver.page
    .getByText(
      new RegExp(`You are in Restricted Mode|${TRUSTED_TEXT.source}`, 'i'),
    )
    .first()
    .waitFor({ state: 'hidden', timeout: 10_000 });
}

/** Grant trust through the real Workspace Trust editor (never a flag or seeded setting). */
export async function grantWorkspaceTrust(
  driver: DesktopDriver,
): Promise<void> {
  if (!(await commandAvailable(driver.page, TRUST_COMMAND)))
    throw new Error('Workspace Trust is unavailable in this Desktop build.');
  await driver.command(TRUST_COMMAND);
  const button = driver.page
    .getByRole('button', { name: /^Trust (?:Folder|Workspace)/ })
    .or(driver.page.getByRole('button', { name: 'Trust', exact: true }))
    .first();
  await button.waitFor({ state: 'visible', timeout: 15_000 });
  await button.click();
  await driver.page
    .getByText(TRUSTED_TEXT)
    .filter({ visible: true })
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 });
}

/**
 * Functional journeys run in a trusted workspace: the Restricted Mode banner and
 * its layout shift are not what they exercise. Confirmed by the public
 * `vscode.workspace.isTrusted`, not by the editor's text.
 */
export async function ensureWorkspaceTrusted(
  driver: Pick<DesktopDriver, 'profileDir' | 'command'>,
  grant: () => Promise<void>,
): Promise<void> {
  if (await readWorkspaceTrust(driver)) return;
  await grant();
  if (!(await readWorkspaceTrust(driver)))
    throw new Error(
      'The workspace still reports Restricted Mode after the trust grant.',
    );
}

/** Launch with the test harness and a trusted workspace; the window is closed if trust fails. */
export async function launchTrustedDesktop(
  options: DesktopLaunchOptions,
): Promise<DesktopDriver> {
  const driver = await launchDesktop({ ...options, testHarness: true });
  try {
    await ensureWorkspaceTrusted(driver, async () => {
      await grantWorkspaceTrust(driver);
      await closeTrustEditor(driver);
    });
  } catch (error) {
    await driver.close().catch(() => {});
    throw error;
  }
  return driver;
}

export function readExecutableVersion(executablePath: string): {
  version: string;
  build: string;
} {
  const directory = dirname(executablePath);
  const candidates = [
    join(directory, 'resources/app'),
    resolve(directory, '../Resources/app'),
  ];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && /^[a-f0-9]{10,40}$/.test(entry.name))
      candidates.push(join(directory, entry.name, 'resources/app'));
  }
  for (const app of candidates) {
    if (
      !existsSync(join(app, 'product.json')) ||
      !existsSync(join(app, 'package.json'))
    )
      continue;
    const product = JSON.parse(readFileSync(join(app, 'product.json'), 'utf8'));
    const manifest = JSON.parse(
      readFileSync(join(app, 'package.json'), 'utf8'),
    );
    if (
      typeof manifest.version === 'string' &&
      /^\d+\.\d+\.\d+/.test(manifest.version) &&
      typeof product.commit === 'string' &&
      /^[a-f0-9]{40}$/.test(product.commit)
    )
      return { version: manifest.version, build: product.commit };
  }
  throw new Error(
    `Cannot verify the installed VS Code version/build beside ${executablePath}`,
  );
}

function installVsix(
  executablePath: string,
  vsixPath: string,
  paths: DesktopPaths,
): void {
  const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(
    executablePath,
    {
      reuseMachineInstall: true,
    },
  );
  if (!cli) throw new Error('VS Code CLI not found');
  execFileSync(
    cli,
    [
      ...args,
      '--user-data-dir',
      paths.profileDir,
      '--extensions-dir',
      paths.extensionsDir,
      `--shared-data-dir=${join(paths.profileDir, 'shared-data')}`,
      '--install-extension',
      vsixPath,
      '--force',
    ],
    {
      stdio: 'pipe',
      timeout: INSTALL_TIMEOUT,
      shell: process.platform === 'win32',
    },
  );
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((done, reject) => {
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => done())
      .on('error', reject);
  });
  return hash.digest('hex');
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Playwright can drop a just-launched app's evaluate with "Resulting promise
 * was garbage collected". The caller's action must be idempotent: it is
 * repeated up to three attempts in total, after a short backoff.
 */
export async function retryTransientEvaluate<T>(
  action: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      const transient =
        error instanceof Error &&
        /Resulting promise was garbage collected/i.test(error.message);
      if (!transient || attempt >= attempts) throw error;
      await delay(250 * attempt);
    }
  }
}

async function settle(
  label: string,
  action: () => Promise<unknown>,
  ms: number,
): Promise<void> {
  try {
    await withTimeout(action(), ms, label);
  } catch {
    // Bounded cleanup: a hanging transport must not strand the run.
  }
}

async function removeProfile(profileDir: string): Promise<void> {
  await settle(
    'Desktop profile removal',
    () =>
      rm(profileDir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      }),
    PROFILE_REMOVE_TIMEOUT,
  );
}

function killProcessTree(pid: number | undefined, processGroup: boolean): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: 10_000,
      });
    } else {
      process.kill(processGroup ? -pid : pid, 'SIGKILL');
    }
  } catch {
    // The process or group already exited.
  }
}

export interface DesktopShutdown {
  readonly forced: boolean;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

/** Check the owned process even when the transport's close promise succeeded. */
export async function finishDesktopProcess(
  child: ChildProcess,
): Promise<DesktopShutdown> {
  const forced = child.exitCode === null && child.signalCode === null;
  if (forced) {
    if (!child.pid) throw new Error('Desktop process has no verified PID');
    // Both Playwright's launcher and direct CDP launch create POSIX process groups.
    killProcessTree(child.pid, process.platform !== 'win32');
    await withTimeout(
      new Promise<void>((done) => {
        if (child.exitCode !== null || child.signalCode !== null) done();
        else child.once('exit', () => done());
      }),
      CLOSE_TIMEOUT,
      'Desktop process termination',
    );
  } else if (child.exitCode !== 0 || child.signalCode !== null) {
    throw new Error('VS Code exited abnormally before shutdown completed');
  }
  return { forced, exitCode: child.exitCode, signal: child.signalCode };
}

interface FocusElement {
  tagName?: string;
  id?: string;
  className?: string;
  innerText?: string;
  shadowRoot?: { activeElement?: FocusElement | null } | null;
  getAttribute?: (name: string) => string | null;
}

interface FocusDocument {
  activeElement?: FocusElement | null;
}

function readFocus(): Record<string, unknown> | null {
  const document = (globalThis as unknown as { document?: FocusDocument })
    .document;
  let element = document?.activeElement ?? null;
  while (element?.shadowRoot?.activeElement) {
    element = element.shadowRoot.activeElement;
  }
  if (!element) return null;
  const target = element;
  const attribute = (name: string) => target.getAttribute?.(name) ?? null;
  return {
    tag: target.tagName?.toLowerCase() ?? '',
    id: target.id ?? '',
    role: attribute('role'),
    ariaLabel: attribute('aria-label'),
    title: attribute('title'),
    className: target.className ?? '',
    text: (target.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 240),
  };
}

export async function workbenchLocation(
  contexts: () => BrowserContext[],
  timeoutMs: number,
): Promise<{ context: BrowserContext; page: Page }> {
  const deadline = Date.now() + timeoutMs;
  const seen = new Set<string>();
  while (Date.now() < deadline) {
    for (const context of contexts()) {
      for (const page of context.pages()) {
        if (page.isClosed()) continue;
        seen.add(page.url());
        if (page.url().startsWith('devtools://')) continue;
        page.setDefaultTimeout(1_000);
        // count() takes no timeout and setDefaultTimeout does not apply to it,
        // so a hung page query would otherwise outlive the deadline and strand
        // the launch. Bounded by what remains of the caller's deadline; the
        // catch keeps counts at 0 so other windows and the URL diagnostic stay.
        const count = await withTimeout(
          page.locator('.monaco-workbench').count(),
          Math.min(1_000, Math.max(1, deadline - Date.now())),
          'Workbench locator count',
        ).catch(() => 0);
        if (count > 0) return { context, page };
      }
    }
    await delay(250);
  }
  throw new Error(
    `VS Code workbench window not found within ${timeoutMs}ms (pages: ${
      [...seen].slice(0, 8).join(', ') || 'none'
    })`,
  );
}

async function launchCdp(
  executablePath: string,
  args: string[],
  cwd: string,
): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
  child: ChildProcess;
}> {
  const port = await freePort();
  const cdpArgs = [...args];
  cdpArgs.splice(
    Math.max(0, cdpArgs.length - 1),
    0,
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${port}`,
  );
  const child = spawn(executablePath, cdpArgs, {
    cwd,
    env: stringEnv(process.env),
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: false,
    detached: process.platform !== 'win32',
  });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer | string) => {
    if (stderr.length < 16_384) stderr += chunk.toString();
  });
  const endpoint = `http://127.0.0.1:${port}`;
  const exited = new Promise<never>((_, reject) => {
    child.once('exit', (code, signal) =>
      reject(
        new Error(
          `VS Code exited before CDP was ready (code ${code ?? 'null'}, signal ${
            signal ?? 'none'
          })`,
        ),
      ),
    );
    child.once('error', reject);
  });
  // The process exits normally after close(); keep that expected rejection observed.
  void exited.catch(() => {});
  try {
    await withTimeout(
      waitForCdp(endpoint, exited, LAUNCH_TIMEOUT),
      LAUNCH_TIMEOUT,
      'Chromium CDP endpoint',
    );
    const browser = await chromium.connectOverCDP(endpoint, {
      timeout: WINDOW_TIMEOUT,
    });
    const { context, page } = await workbenchLocation(
      () => browser.contexts(),
      WINDOW_TIMEOUT,
    );
    return { browser, context, page, child };
  } catch (error) {
    killProcessTree(child.pid, true);
    throw new Error(
      `${describeError(error)}${
        stderr ? `\nVS Code stderr:\n${stderr.slice(-4_000)}` : ''
      }`,
      { cause: error },
    );
  }
}

async function waitForCdp(
  endpoint: string,
  exited: Promise<never>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/json/version`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // The endpoint is not ready yet; retry until exit or the deadline.
    }
    await Promise.race([delay(100), exited]);
  }
  throw new Error(`Chromium CDP endpoint not ready within ${timeoutMs}ms`);
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port =
        typeof address === 'object' && address ? address.port : undefined;
      server.close((error) => {
        if (error) reject(error);
        else if (port) resolvePort(port);
        else reject(new Error('Could not allocate a CDP port'));
      });
    });
  });
}

async function findDesignerFrame(
  page: Page,
  timeoutMs: number,
): Promise<Frame | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const matches: Frame[] = [];
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const count = await frame
        .locator('rdlc-editor')
        .count()
        .catch(() => 0);
      if (count > 0) matches.push(frame);
    }
    if (matches.length > 1)
      throw new Error(
        'Ambiguous designer frames: select a document/view explicitly before automation',
      );
    if (matches.length === 1) return matches[0];
    await delay(200);
  }
  return undefined;
}

async function startTrace(context: BrowserContext): Promise<boolean> {
  try {
    await withTimeout(
      context.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: false,
      }),
      TRACE_TIMEOUT,
      'Trace start',
    );
    return true;
  } catch (error) {
    throw new Error(
      `Mandatory Desktop trace capture failed: ${describeError(error)}`,
      { cause: error },
    );
  }
}

/**
 * Opens the focused list row's context menu with the keyboard only. VS Code
 * lists react to the keyup of Shift+F10 or of the ContextMenu key (keyCode 58);
 * on macOS the ContextMenu key (93) is decoded as the Meta key, so Shift+F10 is
 * the portable gesture. A gesture lost to a focus change in flight is retried.
 */
export async function openContextMenuWithKeyboard(
  page: Page,
  timeout = 4_000,
): Promise<void> {
  const item = page.locator('.context-view').getByRole('menuitem').first();
  for (const key of ['Shift+F10', 'ContextMenu', 'Shift+F10']) {
    await page.keyboard.press(key);
    const opened = await item
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
    if (opened) return;
  }
}

/**
 * One palette round trip: open the command palette, run `id` and confirm the
 * palette closed. Every caller (specs and the trust helpers) shares it, so its
 * recovery is shared too: a transport that stops answering must not turn a
 * failed command into an unbounded wait.
 */
export async function workbenchCommand(page: Page, id: string): Promise<void> {
  if (!id.trim()) throw new Error('Command id must not be empty');
  await page.bringToFront();
  const input = page.locator(
    '.quick-input-widget:visible .quick-input-box input',
  );
  const rows = page.locator(
    '.quick-input-widget:visible .quick-input-list .monaco-list-row',
  );
  const shortcut =
    process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P';
  // A slow runner can lose the shortcut or the typed text to a webview that
  // grabs focus late (the designer right after it opens), so opening the
  // palette and finding the row is retried before the command is declared
  // unavailable. The failures of every attempt are kept for the report.
  const attempts: unknown[] = [];
  let target: Locator | undefined;
  for (let attempt = 1; attempt <= PALETTE_ATTEMPTS && !target; attempt++) {
    try {
      // Ctrl+P has just closed; its hidden input must not swallow the shortcut.
      await page
        .locator('.quick-input-widget:visible')
        .waitFor({ state: 'hidden', timeout: 5_000 })
        .catch(() => {});
      // A focused webview iframe owns the keyboard; return focus to the workbench.
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
      });
      await page.keyboard.press(shortcut);
      await input.waitFor({ state: 'visible', timeout: PALETTE_STEP_TIMEOUT });
      // fill() writes into the palette input itself: typed keys would land in
      // the focused editor (and dirty it) whenever the palette loses focus to
      // a late-focusing editor between the shortcut and the first character.
      await input.fill(`>${id}`);
      const listed = rows.filter({ hasText: id }).first();
      await listed.waitFor({ state: 'visible', timeout: PALETTE_STEP_TIMEOUT });
      // Fuzzy ranking can list other commands first: prefer the exact label.
      const exact = rows.filter({
        has: page
          .locator('.label-name')
          .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(id)}\\s*$`) }),
      });
      target = (await exact.count()) > 0 ? exact.first() : listed;
    } catch (error) {
      attempts.push(error);
      // Leave a half-typed palette behind only if the dismissal itself fails.
      await withTimeout(
        page.keyboard.press('Escape'),
        COMMAND_TIMEOUT,
        'Command palette recovery',
      ).catch((recovery) => attempts.push(recovery));
    }
  }
  if (!target)
    throw new AggregateError(
      attempts,
      `Command palette did not list ${id} after ${PALETTE_ATTEMPTS} attempts: ${attempts
        .map(describeError)
        .join(' | ')}`,
    );
  await target.click({ timeout: COMMAND_TIMEOUT });
  try {
    await input.waitFor({ state: 'hidden', timeout: COMMAND_TIMEOUT });
  } catch (error) {
    // The palette stayed open: dismiss it, and keep both failures when the
    // dismissal itself hangs or fails (the unresponsive-transport case).
    try {
      await withTimeout(
        page.keyboard.press('Escape'),
        COMMAND_TIMEOUT,
        'Command palette recovery',
      );
    } catch (recovery) {
      throw new AggregateError(
        [error, recovery],
        `Command palette did not execute ${id}: ${describeError(error)}`,
      );
    }
    throw new Error(
      `Command palette did not execute ${id}: ${describeError(error)}`,
    );
  }
}

/**
 * Launches the real @vscode/test-electron binary in a disposable profile.
 * The Electron API is tried first; if its Node inspection is disabled by the
 * shipped fuses, the same binary is launched with the public Chromium
 * --remote-debugging-port switch and driven through connectOverCDP. The chosen
 * transport is recorded in identity.
 */
export async function launchDesktop(
  options: DesktopLaunchOptions,
): Promise<DesktopDriver> {
  const resolved = validateDesktopOptions(options);
  const paths = desktopPaths(resolved);
  const captureRoot = join(resolved.artifactDir, 'captures');
  const executablePath = await downloadAndUnzipVSCode(resolved.version);
  const executableSha256 = await sha256File(executablePath);
  const executableVersion = readExecutableVersion(executablePath);
  const launchArgs = desktopLaunchArgs(resolved, paths);

  mkdirSync(paths.profileDir, { recursive: true });
  // Sticky-scroll ancestor rows overlay real tree rows and intercept their
  // pointer input; the journeys address the rows themselves.
  mkdirSync(join(paths.profileDir, 'User'), { recursive: true });
  writeFileSync(
    join(paths.profileDir, 'User', 'settings.json'),
    `${JSON.stringify(
      {
        'workbench.tree.enableStickyScroll': false,
        // macOS opens native NSMenu context menus by default; they are not in
        // the DOM, so the journeys could never see or drive their items.
        // The custom (HTML) menu is what Linux and Windows already use.
        'window.menuStyle': 'custom',
        'git.enabled': false,
        'git.autoRepositoryDetection': false,
        // An "update available" badge appears on the Manage gear at random,
        // which no reference capture can reproduce.
        'update.mode': 'none',
        'extensions.autoCheckUpdates': false,
        // No background network or feature activity: the host observers
        // must only see what the RDLC extension and the journeys cause.
        // Workspace trust settings are deliberately left untouched.
        'telemetry.telemetryLevel': 'off',
        'workbench.enableExperiments': false,
        'workbench.settings.enableNaturalLanguageSearch': false,
        'extensions.autoUpdate': false,
        'extensions.ignoreRecommendations': true,
        'npm.fetchOnlinePackageInfo': false,
        'json.schemaDownload.enable': false,
        'typescript.disableAutomaticTypeAcquisition': true,
        'workbench.cloudChanges.autoResume': 'off',
        'workbench.cloudChanges.continueOn': 'off',
        'chat.disableAIFeatures': true,
        // Terminal completions and shell-integration scripts probe PATH and
        // the file system in the background; the security probe only types a
        // plain command into the terminal and needs neither.
        'terminal.integrated.suggest.enabled': false,
        'terminal.integrated.shellIntegration.enabled': false,
        // Task providers and the debugger scan the workspace and its tools.
        'task.autoDetect': 'off',
        'gulp.autoDetect': 'off',
        'grunt.autoDetect': 'off',
        'jake.autoDetect': 'off',
        'debug.javascript.autoAttachFilter': 'disabled',
        'workbench.startupEditor': 'none',
        'workbench.welcomePage.walkthroughs.openOnInstall': false,
      },
      null,
      2,
    )}
`,
  );
  mkdirSync(paths.extensionsDir, { recursive: true });
  mkdirSync(captureRoot, { recursive: true });

  let vsixSha256: string | undefined;
  try {
    if (resolved.packaged) {
      const vsixPath = resolved.vsixPath;
      if (!vsixPath) {
        throw new Error('Packaged Desktop launch requires vsixPath');
      }
      vsixSha256 = await sha256File(vsixPath);
      installVsix(executablePath, vsixPath, paths);
    }
  } catch (error) {
    await removeProfile(paths.profileDir);
    throw error;
  }

  let app: ElectronApplication | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let child: ChildProcess | undefined;
  let transport: DesktopIdentity['transport'] | undefined;
  let electronError: string | undefined;
  let windowGeometry: WindowGeometry | UnknownWindowGeometry | undefined;

  try {
    try {
      app = await withTimeout(
        electron.launch({
          executablePath,
          args: launchArgs,
          cwd: resolved.root,
          env: stringEnv(process.env),
          timeout: LAUNCH_TIMEOUT,
          artifactsDir: join(resolved.artifactDir, 'playwright-electron'),
        }),
        LAUNCH_TIMEOUT + 5_000,
        'Electron launch',
      );
      child = app.process();
      await app.firstWindow({ timeout: WINDOW_TIMEOUT });
      const located = await workbenchLocation(
        () => [app!.context()],
        WINDOW_TIMEOUT,
      );
      context = located.context;
      page = located.page;
      transport = 'electron';
    } catch (error) {
      electronError = describeError(error);
      if (app) {
        await settle(
          'Electron close after launch failure',
          () => app!.close(),
          CLOSE_TIMEOUT,
        );
      }
      app = undefined;
      context = undefined;
      page = undefined;
      if (child?.pid) killProcessTree(child.pid, process.platform !== 'win32');
      child = undefined;
    }

    if (!page || !context) {
      const cdp = await launchCdp(executablePath, launchArgs, resolved.root);
      browser = cdp.browser;
      context = cdp.context;
      page = cdp.page;
      child = cdp.child;
      transport = 'cdp';
    }

    if (!transport || !page || !context) {
      throw new Error('Desktop transport did not yield a workbench page');
    }

    await withTimeout(
      page.waitForSelector('.monaco-workbench', { timeout: WINDOW_TIMEOUT }),
      WINDOW_TIMEOUT + 5_000,
      'VS Code workbench',
    );
    page.setDefaultTimeout(COMMAND_TIMEOUT);
    // One window geometry on every host: a 1024x768 CI desktop otherwise puts
    // the workbench and designer into their narrow layouts.
    if (!app)
      windowGeometry = unknownWindowGeometry(
        'The CDP transport exposes no window or display to measure.',
      );
    else {
      const electronApp = app;
      // Both evaluates are idempotent, so a transient Playwright failure right
      // after launch may be repeated; any other error is rethrown at once.
      const display = await retryTransientEvaluate(() =>
        withTimeout(
          electronApp.evaluate(({ BrowserWindow, screen }) => {
            const window = BrowserWindow.getAllWindows().find(
              (candidate: { isDestroyed(): boolean }) =>
                !candidate.isDestroyed(),
            );
            if (!window) return null;
            if (window.isMaximized()) window.unmaximize();
            const bounds = window.getBounds();
            const inner = window.getContentBounds();
            const area = screen.getDisplayMatching(bounds).workArea;
            return {
              frame: {
                width: bounds.width - inner.width,
                height: bounds.height - inner.height,
              },
              workArea: { width: area.width, height: area.height },
            };
          }),
          COMMAND_TIMEOUT,
          'Desktop display work area',
        ),
      );
      if (!display)
        windowGeometry = unknownWindowGeometry(
          'Electron reported no live window to measure.',
        );
      else {
        // macOS clamps a window to the display work area, X11 and Windows do
        // not: ask for the size that fits and read back what was granted.
        const requested = fitContentSize(
          WINDOW_CONTENT_SIZE,
          display.workArea,
          display.frame,
        );
        const content = await retryTransientEvaluate(() =>
          withTimeout(
            electronApp.evaluate(({ BrowserWindow }, size) => {
              const window = BrowserWindow.getAllWindows().find(
                (candidate: { isDestroyed(): boolean }) =>
                  !candidate.isDestroyed(),
              );
              if (!window) return null;
              window.setContentSize(size.width, size.height);
              const inner = window.getContentBounds();
              return { width: inner.width, height: inner.height };
            }, requested),
            COMMAND_TIMEOUT,
            'Desktop window size',
          ),
        );
        if (!content)
          windowGeometry = unknownWindowGeometry(
            'The window disappeared before it could be sized.',
          );
        else {
          windowGeometry = assessWindowGeometry({
            requested,
            content,
            workArea: display.workArea,
          });
          if (windowGeometry.status === 'constrained')
            console.warn(
              `Desktop window is constrained to ${content.width}x${content.height} ` +
                `(wanted ${WINDOW_CONTENT_SIZE.width}x${WINDOW_CONTENT_SIZE.height}; ` +
                `work area ${display.workArea.width}x${display.workArea.height}).`,
            );
        }
      }
    }
    const workbenchPage = page;
    const workbenchContext = context;
    const actualTransport = transport;
    const tracing = await startTrace(workbenchContext);

    if (!child?.pid)
      throw new Error('Desktop launch has no owned process identity');
    const identity: DesktopIdentity = {
      processId: child.pid,
      version: executableVersion.version,
      requestedVersion: resolved.version,
      build: executableVersion.build,
      environment: {
        platform: platform(),
        osRelease: release(),
        architecture: arch(),
        observed: await workbenchPage.evaluate(() => ({
          locale: navigator.language,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          display: {
            width: screen.width,
            height: screen.height,
            dpr: devicePixelRatio,
          },
          window: {
            width: outerWidth,
            height: outerHeight,
            contentWidth: innerWidth,
            contentHeight: innerHeight,
          },
          theme: document.querySelector('.monaco-workbench')?.className ?? null,
          fontFamily: getComputedStyle(document.body).fontFamily,
          fonts: [...document.fonts].map((font) => ({
            family: font.family,
            style: font.style,
            weight: font.weight,
            status: font.status,
          })),
        })),
      },
      executablePath,
      executableSha256,
      transport: actualTransport,
      transportDetail:
        actualTransport === 'electron'
          ? 'playwright _electron.launch'
          : 'chromium.connectOverCDP with --remote-debugging-port',
      driver: 'playwright@1.64.1',
      profileDir: paths.profileDir,
      workspace: paths.workspaceDir,
      launchArgs,
      packaged: resolved.packaged,
      trace: tracing ? 'started' : 'unavailable',
      ...(vsixSha256 ? { vsixSha256 } : {}),
      ...(windowGeometry ? { windowGeometry } : {}),
      ...(electronError ? { electronError } : {}),
    };
    const identityDir = join(resolved.artifactDir, 'identity');
    mkdirSync(identityDir, { recursive: true });
    const identityPath = join(
      identityDir,
      `driver-${safeSegment(resolved.version)}-${
        resolved.packaged ? 'packaged' : 'development'
      }-${Date.now()}.json`,
    );
    identity['identityPath'] = identityPath;
    writeFileSync(
      identityPath,
      `${JSON.stringify(identity, null, 2)}\n`,
      'utf8',
    );

    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      if (!closing) {
        closing = (async () => {
          const errors: unknown[] = [];
          if (tracing) {
            const tracePath = join(
              resolved.artifactDir,
              `trace-${process.pid}-${Date.now()}.zip`,
            );
            try {
              await withTimeout(
                workbenchContext.tracing.stop({ path: tracePath }),
                TRACE_STOP_TIMEOUT,
                'Trace stop',
              );
              identity['tracePath'] = tracePath;
            } catch (error) {
              identity['traceError'] = describeError(error);
              errors.push(error);
            }
          }
          if (app) {
            try {
              await withTimeout(app.close(), CLOSE_TIMEOUT, 'Electron close');
            } catch (error) {
              errors.push(error);
            }
          }
          if (browser) {
            try {
              await withTimeout(browser.close(), CLOSE_TIMEOUT, 'CDP close');
            } catch (error) {
              errors.push(error);
            }
          }
          try {
            if (!child) throw new Error('Desktop process identity is missing');
            identity['shutdown'] = await finishDesktopProcess(child);
          } catch (error) {
            identity['shutdownError'] = describeError(error);
            errors.push(error);
          }
          try {
            await withTimeout(
              rm(paths.profileDir, {
                recursive: true,
                force: true,
                maxRetries: 3,
                retryDelay: 100,
              }),
              PROFILE_REMOVE_TIMEOUT,
              'Desktop profile removal',
            );
            if (existsSync(paths.profileDir))
              throw new Error('Desktop profile was not removed');
          } catch (error) {
            errors.push(error);
          }
          writeFileSync(
            identityPath,
            `${JSON.stringify(identity, null, 2)}\n`,
            'utf8',
          );
          if (errors.length)
            throw new AggregateError(
              errors,
              'Desktop shutdown or trace capture failed',
            );
        })();
      }
      return closing;
    };

    const designerFrame = async (): Promise<Frame> => {
      const frame = await findDesignerFrame(workbenchPage, FRAME_TIMEOUT);
      if (!frame) {
        throw new Error(
          `Designer webview frame not found within ${FRAME_TIMEOUT}ms (frames: ${
            workbenchPage
              .frames()
              .map((item) => item.url())
              .join(', ') || 'none'
          })`,
        );
      }
      identity['frameDiscovery'] = {
        url: frame.url(),
        name: frame.name(),
        matchedDesignerCount: 1,
      };
      return frame;
    };

    const command = (id: string): Promise<void> =>
      workbenchCommand(workbenchPage, id);

    const capture = async (name: string): Promise<void> => {
      if (!name.trim()) throw new Error('Capture name must not be empty');
      const directory = join(captureRoot, safeSegment(name));
      mkdirSync(directory, { recursive: true });
      const record: Record<string, unknown> = {
        name,
        capturedAt: new Date().toISOString(),
        identity,
      };
      await withTimeout(
        (async () => {
          record['workbench'] = {
            url: workbenchPage.url(),
            title: await workbenchPage.title(),
          };
          await workbenchPage.screenshot({
            path: join(directory, 'workbench.png'),
            timeout: CAPTURE_TIMEOUT,
          });
          writeFileSync(
            join(directory, 'workbench.aria.yml'),
            await workbenchPage.ariaSnapshot({
              boxes: true,
              timeout: CAPTURE_TIMEOUT,
            }),
            'utf8',
          );
          record['focus'] = await workbenchPage.evaluate(readFocus);
          const frame = await findDesignerFrame(workbenchPage, 2_000);
          if (!frame) return;
          const root = frame.locator('rdlc-root');
          let visible = await root.isVisible();
          for (
            let ancestor: Frame | null = frame;
            visible && ancestor?.parentFrame();
            ancestor = ancestor.parentFrame()
          )
            visible = await (await ancestor.frameElement()).isVisible();
          record['designer'] = {
            url: frame.url(),
            focus: await frame.evaluate(readFocus),
            visible,
          };
          // A source editor may be active while its retained designer frame is hidden.
          if (!visible) return;
          await root.screenshot({
            path: join(directory, 'designer.png'),
            timeout: CAPTURE_TIMEOUT,
          });
          writeFileSync(
            join(directory, 'designer.aria.yml'),
            await root.ariaSnapshot({
              boxes: true,
              timeout: CAPTURE_TIMEOUT,
            }),
            'utf8',
          );
        })(),
        CAPTURE_TIMEOUT * 2,
        `Capture ${name}`,
      );
      writeFileSync(
        join(directory, 'capture.json'),
        `${JSON.stringify(record, null, 2)}\n`,
        'utf8',
      );
    };

    return {
      page: workbenchPage,
      context: workbenchContext,
      identity,
      profileDir: paths.profileDir,
      designerFrame,
      command,
      capture,
      close,
    };
  } catch (error) {
    if (app) {
      await settle(
        'Electron close after launch failure',
        () => app!.close(),
        CLOSE_TIMEOUT,
      );
    }
    if (browser) {
      await settle(
        'CDP close after launch failure',
        () => browser!.close(),
        CLOSE_TIMEOUT,
      );
    }
    if (child?.pid) killProcessTree(child.pid, process.platform !== 'win32');
    await removeProfile(paths.profileDir);
    const electronDetail = electronError
      ? ` Electron transport failed: ${electronError}.`
      : '';
    throw new Error(
      `Desktop launch failed.${electronDetail} ${describeError(error)}`,
      { cause: error },
    );
  }
}
