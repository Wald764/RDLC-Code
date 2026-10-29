import { test, expect } from 'playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BrowserContext, Page } from 'playwright';
import {
  closeTrustEditor,
  commandAvailable,
  grantWorkspaceTrust,
  launchDesktop,
  readWorkspaceTrust,
  TRUST_COMMAND,
  TRUSTED_TEXT,
  type DesktopDriver,
} from './driver.js';
import {
  hostObserverSkipReason,
  hostObserverUnsupported,
} from './host-observer-scope.js';
import {
  createSecurityObserver,
  detectSecurityCapability,
  enableHostBlocking,
  newCanaryName,
  sanitizeTarget,
  SecurityObserverUnsupportedError,
  unexpectedEvents,
  type AllowedAccess,
  type HostBlocking,
  type SecurityCapability,
  type SecurityObservation,
} from './security-observer.js';

type TrustState = 'trusted' | 'restricted' | 'unavailable';
type Profile = 'restricted' | 'trusted';

const RESTRICTED_TEXT = /You are in Restricted Mode|In Restricted Mode/i;
const PROBE_URL =
  'https://security-probe.invalid/rdlc?token=sentinel-secret&query=private';
const PROBE_ORIGIN = 'https://security-probe.invalid';
// Renderer-page controls: an allowed loopback request and a blocked non-loopback one.
const BLOCKED_ORIGIN = 'https://rdlc-blocked-control.invalid';

/**
 * Real host child-process attempts, run outside any report journey: a file open
 * of the canary (outside every allowlist), a missing file, execve, a loopback
 * connect and a non-loopback connect that host blocking must refuse.
 */
function hostProbe(canaryPath: string): string {
  if (/["'\\\s]/.test(canaryPath))
    throw new Error('The canary path must be shell- and JS-safe.');
  return `node -e 'const fs=require("node:fs");try{fs.openSync("/nonexistent/rdlc-security-host-file","r")}catch{};try{fs.openSync("${canaryPath}","r")}catch{};require("node:child_process").execFile("/nonexistent/rdlc-security-host-exec",()=>{});require("node:net").connect({host:"127.0.0.1",port:1}).on("error",()=>{});require("node:net").connect({host:"203.0.113.9",port:443}).on("error",()=>{});setTimeout(()=>process.exit(0),800)'`;
}

/**
 * Authoritative trust state: the public `vscode.workspace.isTrusted`, reported by
 * the test-only harness extension. With Workspace Trust disabled the API answers
 * true, so a restricted profile can never be satisfied by accident.
 */
async function readTrustState(driver: DesktopDriver): Promise<TrustState> {
  try {
    return (await readWorkspaceTrust(driver)) ? 'trusted' : 'restricted';
  } catch {
    return 'unavailable';
  }
}

/** Supplementary UI evidence from the Workspace Trust editor; never the gate. */
async function readTrustUi(driver: DesktopDriver): Promise<TrustState> {
  try {
    if (!(await commandAvailable(driver.page, TRUST_COMMAND)))
      return 'unavailable';
    await driver.command(TRUST_COMMAND);
    await driver.page
      .waitForFunction(
        () => /Restricted Mode|You trust/.test(document.body.innerText),
        undefined,
        { timeout: 15_000 },
      )
      .catch(() => {});
    if (
      await driver.page
        .getByText(RESTRICTED_TEXT)
        .filter({ visible: true })
        .first()
        .isVisible()
    )
      return 'restricted';
    if (
      await driver.page
        .getByText(TRUSTED_TEXT)
        .filter({ visible: true })
        .first()
        .isVisible()
    )
      return 'trusted';
  } catch {
    // Supplementary only.
  }
  return 'unavailable';
}

/** Grant trust through the real Workspace Trust editor, then read the API value. */
async function trustWorkspace(driver: DesktopDriver): Promise<TrustState> {
  await grantWorkspaceTrust(driver);
  return readTrustState(driver);
}

/** Abort non-loopback browser requests. This is supporting coverage, never host proof. */
async function blockOutbound(
  context: BrowserContext,
): Promise<{ blocked: number; hosts: string[] }> {
  const counter = { blocked: 0, hosts: [] as string[] };
  await context.route(/^https?:\/\//, (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === '127.0.0.1' || host === 'localhost') return route.continue();
    counter.blocked++;
    counter.hosts.push(host);
    return route.abort('blockedbyclient');
  });
  return counter;
}

async function runHostProbe(
  driver: DesktopDriver,
  canaryPath: string,
): Promise<void> {
  await driver.command('Terminal: Create New Terminal');
  const terminal = driver.page.locator('.terminal-wrapper').first();
  await terminal.waitFor({ state: 'visible', timeout: 20_000 });
  await terminal.click();
  await driver.page.waitForTimeout(2_000);
  await driver.page.keyboard.insertText(hostProbe(canaryPath));
  await driver.page.keyboard.press('Enter');
  await driver.page.waitForTimeout(2_500);
}

/**
 * Restricted Mode refuses to create a terminal process: VS Code raises a modal
 * Workspace Trust prompt instead. That prompt is the refusal under test, so it is
 * asserted and dismissed with Cancel; trust is never granted from it.
 */
async function expectTerminalRefused(driver: DesktopDriver): Promise<void> {
  await driver.command('Terminal: Create New Terminal');
  const dialog = driver.page
    .locator('.monaco-dialog-box')
    .filter({ hasText: 'Creating a terminal process requires executing code' });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog).toContainText(/trust the authors/i);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(driver.page.locator('.monaco-dialog-modal-block')).toBeHidden();
  // Cancelling must leave the workspace restricted.
  expect(await readWorkspaceTrust(driver)).toBe(false);
}

/**
 * A real report journey: native quick-open of the fixture, the Angular custom
 * editor, and a canvas selection. No test hook replaces any of these actions.
 */
async function reportJourney(
  driver: DesktopDriver,
  fixture: string,
): Promise<void> {
  // A restricted window can reach the journey before the installed extension is
  // registered: the file would open as plain text and the command would be absent.
  if (!(await commandAvailable(driver.page, 'RDLC Code: Open Designer')))
    throw new Error(
      'RDLC Code: Open Designer is not registered in the window.',
    );
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await driver.page.keyboard.press(`${modifier}+p`);
  await driver.page.keyboard.insertText(fixture);
  await driver.page
    .locator('.quick-input-widget:visible .monaco-list-row')
    .filter({ hasText: 'security.rdlc' })
    .first()
    .click();
  await expect(driver.page.locator('.quick-input-box input')).toBeHidden();
  await driver.command('RDLC Code: Open Designer');
  const frame = await driver.designerFrame();
  // The hostile fixture must really be loaded: its external Image renders as an
  // unsupported placeholder on the canvas, before any inertness is asserted.
  await expect(
    frame.locator('[data-kind="preserved"][aria-label="Image (unsupported)"]'),
  ).toBeVisible();
  const textbox = frame.locator('[data-card="Textbox"]');
  if (!(await textbox.isVisible()))
    await frame
      .getByRole('button', { name: 'Components', exact: true })
      .click();
  await expect(textbox).toBeVisible();
  await textbox.click();
}

/**
 * Blocked-fetch positive control inside the actual Angular webview frame. The
 * webview CSP (connect-src 'none') refuses it before the network, so the
 * in-frame securitypolicyviolation record is the attempted-access observation.
 */
async function webviewControl(driver: DesktopDriver): Promise<{
  rejected: boolean;
  directive: string | null;
  blockedOrigin: string | null;
}> {
  const frame = await driver.designerFrame();
  return frame.evaluate(async (url) => {
    const record = {
      rejected: false,
      directive: null as string | null,
      blockedOrigin: null as string | null,
    };
    const violated = new Promise<void>((done) => {
      document.addEventListener(
        'securitypolicyviolation',
        (event) => {
          record.directive = event.violatedDirective;
          try {
            record.blockedOrigin = new URL(event.blockedURI).origin;
          } catch {
            record.blockedOrigin = event.blockedURI;
          }
          done();
        },
        { once: true },
      );
      setTimeout(done, 3_000);
    });
    try {
      await fetch(url, { mode: 'no-cors' });
    } catch {
      record.rejected = true;
    }
    await violated;
    return record;
  }, PROBE_URL);
}

/** A loopback port nothing listens on: the request is allowed and then refused. */
async function closedLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen) =>
    server.listen(0, '127.0.0.1', resolveListen),
  );
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return port;
}

/**
 * Positive controls for the webview network listener, issued from the workbench
 * renderer page: an allowed loopback request that must appear as a request
 * event, and a non-loopback request that blockOutbound must abort and count.
 */
async function networkListenerControl(
  page: Page,
  loopbackUrl: string,
): Promise<{
  loopback: 'fulfilled' | 'rejected';
  blocked: 'rejected' | 'other';
}> {
  return page.evaluate(
    async ({ loopback, blocked }) => {
      const attempt = (url: string) =>
        fetch(url, { mode: 'no-cors' }).then(
          () => 'fulfilled' as const,
          () => 'rejected' as const,
        );
      const first = await attempt(loopback);
      const second = await attempt(blocked);
      return {
        loopback: first,
        blocked:
          second === 'rejected' ? ('rejected' as const) : ('other' as const),
      };
    },
    { loopback: loopbackUrl, blocked: `${BLOCKED_ORIGIN}/control` },
  );
}

interface Isolation {
  readonly fixtureDir: string;
  readonly tmpDir: string;
}

/**
 * Raw-path allowlist for the host process tree: writable disposable profile and
 * dedicated tmp dir; read-only fixture, VS Code install and loaded extension
 * dirs. The repository root and the OS tmp dir are not
 * allowed; runtime paths are enumerated in the observer. ponytail: ceiling is
 * the first Linux baseline run (X11 sockets/auth and fontconfig caches are the
 * likely additions); never widen to a whole top-level tree.
 */
function allowedAccess(
  driver: DesktopDriver,
  isolation: Isolation,
): AllowedAccess {
  const install = dirname(driver.identity.executablePath);
  const launchArgs = Array.isArray(driver.identity['launchArgs'])
    ? (driver.identity['launchArgs'] as unknown[])
    : [];
  const extensionDirs = launchArgs
    .filter((arg): arg is string => typeof arg === 'string')
    .filter((arg) => arg.startsWith('--extensionDevelopmentPath='))
    .map((arg) => arg.slice('--extensionDevelopmentPath='.length));
  const home = homedir();
  return {
    // Writable: the disposable profile (incl. extension storage), the dedicated
    // tmp dir and the user's fontconfig cache.
    open: [
      driver.profileDir,
      isolation.tmpDir,
      join(home, '.cache/fontconfig'),
    ],
    // Read-only: the hostile fixture must stay unmodified, as must the install,
    // the loaded extension sources and the X authority file.
    readOnly: [
      isolation.fixtureDir,
      install,
      ...extensionDirs,
      process.env.XAUTHORITY ?? join(home, '.Xauthority'),
    ],
    exec: [install],
  };
}

async function observe(
  driver: DesktopDriver,
  capability: SecurityCapability,
  root: string,
  isolation: Isolation,
  action: () => Promise<void>,
): Promise<SecurityObservation> {
  const rootPid = capability.native.attach.supported
    ? driver.identity.processId
    : null;
  const observer = createSecurityObserver({
    rootPid,
    rootPidDetail: 'the owned Desktop process identity is unavailable',
    context: driver.context,
    capability,
    redactions: [driver.profileDir, root, driver.identity.executablePath],
    allowed: allowedAccess(driver, isolation),
    maxEvents: 400_000,
    maxTraceBytes: 128 * 1024 * 1024,
  });
  await observer.start();
  let error: unknown;
  try {
    await action();
    await driver.page.waitForTimeout(1_000);
  } catch (caught) {
    error = caught;
  }
  const observation = await observer.stop();
  if (error) throw error;
  return observation;
}

interface ProfileRecord {
  journey?: SecurityObservation;
  control?: SecurityObservation;
  hostBlocking?: HostBlocking;
  webviewControl?: Awaited<ReturnType<typeof webviewControl>>;
  networkControl?: Awaited<ReturnType<typeof networkListenerControl>>;
  blockedRequests: number;
  blockedHosts: string[];
}

test('security observer: real trust states, host tree and webview attempts fail closed', async () => {
  test.skip(hostObserverUnsupported(), hostObserverSkipReason() ?? '');
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  const artifacts = resolve(
    process.env.RDLC_DESKTOP_ARTIFACT_DIR ??
      resolve(root, '.vscode-test/desktop-artifacts'),
    'security-observer',
  );
  await mkdir(artifacts, { recursive: true });
  const capability = detectSecurityCapability();
  const native = capability.native.attach.supported;
  const failures: string[] = [];
  const checks: Record<string, string> = {
    launchRestricted: 'unrun',
    trustRestricted: 'unrun',
    terminalRefusedRestricted: 'unrun',
    launchTrusted: 'unrun',
    trustTrusted: 'unrun',
    semanticLimitation: 'unrun',
    sanitization: 'unrun',
    cleanup: 'unrun',
  };
  // Every profile runs the same assertions under blocking and observation; the
  // restricted profile keeps the unprefixed names, the trusted one is prefixed.
  const checkName = (profile: Profile, name: string): string =>
    profile === 'restricted'
      ? name
      : `trusted${name[0]?.toUpperCase() ?? ''}${name.slice(1)}`;
  for (const profile of ['restricted', 'trusted'] as const)
    for (const name of [
      'nativeHost',
      'semanticProof',
      'canaryInert',
      'canaryControl',
      'hostOutboundBlocking',
      'angularWebviewControl',
      'networkListenerControl',
      'webview',
    ])
      checks[checkName(profile, name)] =
        native ||
        ![
          'nativeHost',
          'semanticProof',
          'canaryInert',
          'canaryControl',
        ].includes(name)
          ? 'unrun'
          : 'unsupported';
  const trustStates: Record<string, TrustState | 'unrun'> = {
    restricted: 'unrun',
    trusted: 'unrun',
  };
  const trustUi: Record<string, TrustState | 'unrun'> = {
    restricted: 'unrun',
    trusted: 'unrun',
  };
  const identities: Record<string, unknown> = {};
  const records: Record<Profile, ProfileRecord> = {
    restricted: { blockedRequests: 0, blockedHosts: [] },
    trusted: { blockedRequests: 0, blockedHosts: [] },
  };
  const check = (condition: unknown, message: string): void => {
    if (!condition) failures.push(message);
  };
  const describe = (events: SecurityObservation['native']['events']): string =>
    events
      .slice(0, 5)
      .map((event) => `${event.channel}:${event.operation}:${event.target}`)
      .join(', ');
  let fixtureDir: string | undefined;
  let canaryDir: string | undefined;
  let isolatedTmp: string | undefined;
  const originalTmpdir = process.env.TMPDIR;

  if (!native)
    failures.push(
      `Native host process-tree attach is unsupported: ${capability.native.attach.reason}`,
    );

  const runProfile = async (
    profile: Profile,
    fixture: string,
    canaryPath: string,
    canaryName: string,
    isolation: Isolation,
  ): Promise<void> => {
    const record = records[profile];
    const name = (key: string) => checkName(profile, key);
    const launchKey =
      profile === 'restricted' ? 'launchRestricted' : 'launchTrusted';
    const trustKey =
      profile === 'restricted' ? 'trustRestricted' : 'trustTrusted';
    let driver: DesktopDriver | undefined;
    let blocking: HostBlocking | undefined;
    const release = (): void => {
      try {
        blocking?.release();
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    };
    try {
      checks[launchKey] = 'failed';
      driver = await launchDesktop({
        root,
        version: process.env.VSCODE_VERSION ?? '1.142.0',
        packaged: process.env.RDLC_DESKTOP_PACKAGED === 'true',
        // Test-only trust probe; the product extension is never replaced by it.
        testHarness: true,
        artifactDir: artifacts,
        // The window opens only the fixture folder, never the repository.
        workspaceDir: isolation.fixtureDir,
      });
      checks[launchKey] = 'passed';
      identities[profile] = driver.identity;
      // Packaged runs must exercise the installed VSIX, never the development
      // candidate; the harness is the only extension loaded from source there.
      const launchArgs = (driver.identity['launchArgs'] as string[]) ?? [];
      const developmentCandidate = launchArgs.some((arg) =>
        arg.replaceAll('\\', '/').endsWith('/apps/vscode-extension'),
      );
      check(
        driver.identity.packaged === true
          ? !developmentCandidate && !!driver.identity['vsixSha256']
          : developmentCandidate,
        `${profile}: the product extension is not the expected ${driver.identity.packaged === true ? 'installed VSIX' : 'development candidate'}.`,
      );

      checks[trustKey] = 'failed';
      if (profile === 'restricted') {
        trustStates[profile] = await readTrustState(driver);
        trustUi[profile] = await readTrustUi(driver);
        if (trustUi[profile] !== 'unavailable') await closeTrustEditor(driver);
      } else {
        trustStates[profile] = await trustWorkspace(driver);
        trustUi[profile] = 'trusted';
        await closeTrustEditor(driver);
      }
      check(
        trustStates[profile] === profile,
        `The ${profile} profile reported trust state "${trustStates[profile]}".`,
      );
      if (trustStates[profile] === profile) checks[trustKey] = 'passed';

      // Provisioning (download, launch, VSIX install, trust) is complete: block now.
      const blocked = await blockOutbound(driver.context);
      checks[name('hostOutboundBlocking')] = 'failed';
      try {
        blocking = await enableHostBlocking();
        record.hostBlocking = blocking;
        checks[name('hostOutboundBlocking')] = 'passed';
      } catch (error) {
        if (error instanceof SecurityObserverUnsupportedError)
          checks[name('hostOutboundBlocking')] = 'unsupported';
        failures.push(error instanceof Error ? error.message : String(error));
      }

      // Journey window: the hostile fixture is opened and used for real; the host
      // tree must do nothing unexpected and must never touch the canary.
      const journey = await observe(driver, capability, root, isolation, () =>
        reportJourney(driver!, fixture),
      );
      record.journey = journey;
      if (native) {
        const unexpected = unexpectedEvents(journey.native.events);
        check(
          journey.native.events.length > 0 &&
            journey.native.state === 'observed',
          `${profile} journey host observation was ${journey.native.state} with ${journey.native.events.length} events: ${journey.native.reason ?? 'no reason'}`,
        );
        check(
          unexpected.length === 0,
          `${profile} journey produced ${unexpected.length} unexpected file/exec/network events: ${describe(unexpected)}`,
        );
        const opened = journey.native.events.filter((event) =>
          event.target.includes(canaryName),
        );
        check(
          opened.length === 0,
          `${profile} journey touched the canary outside the allowlist: ${describe(opened)}`,
        );
        if (
          journey.native.state === 'observed' &&
          journey.native.events.length > 0 &&
          unexpected.length === 0
        )
          checks[name('semanticProof')] = 'passed';
        if (opened.length === 0 && journey.native.state === 'observed')
          checks[name('canaryInert')] = 'passed';
      }

      // Control window: harness-only attempts must be observed and refused.
      const loopbackPort = await closedLoopbackPort();
      const control = await observe(
        driver,
        capability,
        root,
        isolation,
        async () => {
          record.webviewControl = await webviewControl(driver!);
          record.networkControl = await networkListenerControl(
            driver!.page,
            `https://127.0.0.1:${loopbackPort}/control`,
          );
          // Restricted Mode cannot host the probe terminal: its refusal is the
          // assertion, and the probe-only evidence is required of the trusted run.
          if (profile === 'restricted') {
            checks.terminalRefusedRestricted = 'failed';
            await expectTerminalRefused(driver!);
            checks.terminalRefusedRestricted = 'passed';
          } else if (native) await runHostProbe(driver!, canaryPath);
        },
      );
      record.control = control;
      record.blockedRequests = blocked.blocked;
      record.blockedHosts = blocked.hosts;
      release();

      const webview = record.webviewControl;
      const webviewObserved =
        webview?.rejected === true &&
        webview.directive === 'connect-src' &&
        webview.blockedOrigin === PROBE_ORIGIN;
      check(
        webviewObserved,
        `${profile}: the blocked fetch inside the Angular webview frame was not observed (${JSON.stringify(webview ?? null)}).`,
      );
      if (webviewObserved) checks[name('angularWebviewControl')] = 'passed';
      check(
        control.webview.state === 'observed',
        `${profile} webview observation was ${control.webview.state}: ${control.webview.reason ?? 'no reason'}`,
      );
      if (
        checks[name('angularWebviewControl')] === 'passed' &&
        control.webview.state === 'observed'
      )
        checks[name('webview')] = 'passed';

      // The listener itself must fire: an allowed loopback request is captured,
      // and a refused non-loopback request is both captured and counted.
      const events = control.webview.events;
      const loopbackSeen = events.some(
        (event) =>
          event.source === 'webview-network' &&
          event.target === `https://127.0.0.1:${loopbackPort}`,
      );
      const blockedSeen = events.some(
        (event) =>
          event.target === BLOCKED_ORIGIN &&
          event.outcome === 'failed' &&
          event.error === 'net::ERR_BLOCKED_BY_CLIENT',
      );
      const counted = blocked.hosts.includes(new URL(BLOCKED_ORIGIN).hostname);
      check(
        loopbackSeen,
        `${profile}: the allowed loopback request was not captured as a request event (listener positive control).`,
      );
      check(
        blockedSeen && counted && blocked.blocked >= 1,
        `${profile}: the blocked non-loopback request was not captured and counted (blocked=${blocked.blocked}, hosts=${blocked.hosts.slice(0, 5).join(',')}).`,
      );
      check(
        !blocked.hosts.some(
          (host) => host === '127.0.0.1' || host === 'localhost',
        ),
        `${profile}: a loopback request was counted as blocked.`,
      );
      if (loopbackSeen && blockedSeen && counted && blocked.blocked >= 1)
        checks[name('networkListenerControl')] = 'passed';

      if (native) {
        const nativeEvents = control.native.events;
        check(
          control.native.state === 'observed',
          `${profile} attached host observation was ${control.native.state}: ${control.native.reason ?? 'no reason'}`,
        );
        if (profile === 'trusted') {
          check(
            nativeEvents.some(
              (event) =>
                event.channel === 'network' &&
                event.outcome === 'failed' &&
                event.target === '127.0.0.1:1',
            ),
            `${profile}: failed host network attempt was not captured.`,
          );
          // Host-level blocking positive control: the refused attempt is a failed connect.
          check(
            nativeEvents.some(
              (event) =>
                event.channel === 'network' &&
                event.outcome === 'failed' &&
                event.target === '203.0.113.9:443' &&
                event.unexpected === true,
            ),
            `${profile}: the non-loopback host connect was not observed as refused by host-level blocking.`,
          );
          check(
            nativeEvents.some(
              (event) =>
                event.channel === 'file' &&
                event.outcome === 'failed' &&
                event.target.includes('rdlc-security-host-file') &&
                event.unexpected === true,
            ),
            `${profile}: harness-only file open was not observed and classified outside the allowlist.`,
          );
          // The harness-only open of the canary must be detected as unexpected.
          check(
            nativeEvents.some(
              (event) =>
                event.channel === 'file' &&
                event.target.includes(canaryName) &&
                event.unexpected === true,
            ),
            `${profile}: the harness-only canary open was not detected as unexpected.`,
          );
          check(
            nativeEvents.some(
              (event) =>
                event.channel === 'exec' &&
                event.outcome === 'failed' &&
                event.target === 'rdlc-security-host-exec' &&
                event.unexpected === true,
            ),
            `${profile}: harness-only execve was not observed and classified outside the allowlist.`,
          );
          check(
            nativeEvents.some((event) => event.channel === 'process'),
            `${profile}: host process creation was not captured.`,
          );
          check(
            new Set(
              nativeEvents
                .map((event) => event.pid)
                .filter((pid): pid is number => pid !== null),
            ).size > 1,
            `${profile}: host capture did not include the short-lived probe descendant.`,
          );
        } else {
          // No terminal exists in Restricted Mode: the probe must not have run.
          check(
            !nativeEvents.some(
              (event) =>
                event.target.includes('rdlc-security-host-') ||
                event.target.includes(canaryName),
            ),
            `${profile}: a host probe attempt was observed although the terminal was refused.`,
          );
        }
        check(
          control.captureComplete && journey.captureComplete,
          `${profile} host observation was incomplete: ${[...control.failures, ...journey.failures].join(' ') || 'no failure recorded'}`,
        );
        // The positive control needs the probe terminal, which only a trusted
        // window can create.
        const canaryControl = nativeEvents.some(
          (event) =>
            event.channel === 'file' &&
            event.target.includes(canaryName) &&
            event.unexpected === true,
        );
        if (profile === 'trusted' && canaryControl)
          checks[name('canaryControl')] = 'passed';
        else if (profile === 'restricted') delete checks[name('canaryControl')];
        checks[name('nativeHost')] =
          control.native.state === 'observed' &&
          journey.native.state === 'observed'
            ? 'passed'
            : 'failed';
        if (
          checks[name('semanticProof')] === 'passed' &&
          (checks[name('nativeHost')] !== 'passed' ||
            (profile === 'trusted' &&
              !nativeEvents.some((event) => event.unexpected === true)))
        )
          checks[name('semanticProof')] = 'failed';
      }
    } catch (error) {
      failures.push(
        `${profile}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      release();
      try {
        await driver?.close();
      } catch (error) {
        failures.push(
          `Desktop cleanup failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  };

  try {
    fixtureDir = await mkdtemp(
      resolve(root, '.vscode-test/desktop-fixture-sec-'),
    );
    // The canary lives in its own tmp dir, outside every allowlist.
    canaryDir = await mkdtemp(join(tmpdir(), 'rdlc-canary-'));
    const canaryName = newCanaryName();
    const canaryPath = join(canaryDir, canaryName);
    // A redacted target would make "canary untouched" and the control vacuous.
    if (!sanitizeTarget(canaryPath).endsWith(canaryName))
      throw new Error(
        'The canary name would be redacted from event targets; use a shorter temporary directory.',
      );
    await writeFile(canaryPath, 'rdlc canary: this file must never be read\n');
    isolatedTmp = await mkdtemp(join(tmpdir(), 'rdlc-desktop-tmp-'));
    // The Desktop tree writes its temp files here; the OS tmp dir stays off-limits.
    process.env.TMPDIR = isolatedTmp;
    const isolation: Isolation = { fixtureDir, tmpDir: isolatedTmp };

    // Hostile fixture: external image and data source references to the canary.
    const fixture = join(fixtureDir, 'security.rdlc');
    const template = await readFile(
      resolve(root, 'tests/fixtures/security/canary-references.rdlc'),
      'utf8',
    );
    await writeFile(
      fixture,
      template
        .replaceAll('__RDLC_CANARY_URL__', pathToFileURL(canaryPath).href)
        .replaceAll('__RDLC_CANARY_PATH__', canaryPath),
      'utf8',
    );

    await runProfile('restricted', fixture, canaryPath, canaryName, isolation);
    // Provisioning of the trusted profile happens after blocking was released.
    await runProfile('trusted', fixture, canaryPath, canaryName, isolation);

    const serialized = JSON.stringify([
      records.restricted.control,
      records.restricted.journey,
      records.trusted.control,
      records.trusted.journey,
      records.restricted.webviewControl,
      records.trusted.webviewControl,
    ]);
    const clean =
      !serialized.includes('sentinel-secret') &&
      !serialized.includes('query=private');
    check(
      clean,
      'Sanitized observation leaked an outbound URL query or payload.',
    );
    if (clean) checks.sanitization = 'passed';

    check(
      Object.values(capability.semantic).every(
        (value) => value === 'not-observable',
      ),
      'Query/entity/resource access was reported as observable without proof.',
    );
    checks.semanticLimitation = 'passed';
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (originalTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTmpdir;
    checks.cleanup = 'failed';
    for (const dir of [fixtureDir, canaryDir, isolatedTmp])
      if (dir)
        await rm(dir, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        }).catch((error: unknown) => {
          failures.push(
            `Desktop cleanup failed: ${basename(dir)} removal: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
    if (!failures.some((failure) => failure.startsWith('Desktop cleanup')))
      checks.cleanup = 'passed';
    const summary = (profile: Profile) => {
      const record = records[profile];
      return {
        trustState: trustStates[profile],
        native: record.control?.native ?? null,
        webview: record.control?.webview ?? null,
        journeyNative: record.journey?.native ?? null,
        captureComplete:
          !!record.control?.captureComplete &&
          !!record.journey?.captureComplete,
        hostBlocking: record.hostBlocking
          ? {
              mechanism: record.hostBlocking.mechanism,
              ipv6: record.hostBlocking.ipv6,
              ipv6Reason: record.hostBlocking.ipv6Reason,
              ruleHits: record.hostBlocking.hits,
              ipv6RuleHits: record.hostBlocking.ipv6Hits,
            }
          : null,
        webviewControl: record.webviewControl ?? null,
        networkListenerControl: record.networkControl ?? null,
        blockedBrowserRequests: record.blockedRequests,
        blockedBrowserHosts: record.blockedHosts,
      };
    };
    const restricted = summary('restricted');
    const trusted = summary('trusted');
    await writeFile(
      resolve(artifacts, 'probe.json'),
      `${JSON.stringify(
        {
          schemaVersion: 2,
          assertion:
            'tests/desktop/security-observer.spec.ts::security observer: real trust states, host tree and webview attempts fail closed',
          capability,
          identity: identities,
          trustStates,
          trustSource:
            'vscode.workspace.isTrusted via the test-only harness command rdlcTests.reportWorkspaceTrust; Workspace Trust enabled, disposable shared-data-dir, trusted profile granted through the Workspace Trust editor.',
          trustUi,
          native: restricted.native,
          webview: restricted.webview,
          journeyNative: restricted.journeyNative,
          captureComplete:
            restricted.captureComplete && trusted.captureComplete,
          hostBlocking: restricted.hostBlocking,
          webviewControl: restricted.webviewControl,
          blockedBrowserRequests: restricted.blockedBrowserRequests,
          trusted,
          browserBlockingScope:
            'Playwright request routing only; it is supporting coverage, not proof of host-level blocking.',
          canaryScope:
            'No current product code path resolves external resources (image URLs, data source connections), so the canary check is a regression guard, not evidence that a resolver was exercised. The hostile fixture is verified loaded in the designer (unsupported Image placeholder) before inertness is asserted; the canary name is short enough to survive target sanitization.',
          semanticScope:
            'Syscall-level only: with blocking active, the hostile canary journey of both the restricted and the trusted profile produced no unexpected file, execve or non-loopback connect and never opened the canary; harness-only attempts (including a canary open) were observed. Query/entity/resource evaluation is not attributed.',
          checks,
          failures,
          validated:
            Object.values(checks).every((value) => value === 'passed') &&
            failures.length === 0,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }

  if (failures.length)
    throw new Error(
      `Security observation is not validated: ${[...new Set(failures)].join(' ')}`,
    );
});
