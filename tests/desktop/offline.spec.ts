/**
 * Feature 005 US6 (T063): installed offline journeys under real host
 * observation.
 *
 * Every test title is the executable assertion ID registered in coverage.json
 * (`tests/desktop/offline.spec.ts::<title>`). FR-030-trust, SC-009, FR-014 and
 * EDGE-05 each open their own disposable window through the same setup
 * (download, VSIX install, real trust grant) and only then activate host
 * blocking, each report journey inside its own observer window. No test
 * reuses another test's session, so they are independent of order and of
 * repetition. US6.4-trusted-restricted repeats the full monitored journey set
 * in a separate restricted profile and a separate trusted profile.
 *
 * Playwright route aborts are supporting coverage only; this file never
 * reports them as host-level proof. Host evidence is strace capture of the
 * Desktop process tree plus the iptables owner-uid REJECT rule and its packet
 * counter. Syscall capture cannot attribute query, entity, expression or
 * resource evaluation to a report (SEMANTIC_PROOF_LIMITATION), so recorded
 * claims stay at observable network/file/exec/process attempts, report-frame
 * requests and byte-exact source.
 *
 * Scope honesty, carried by every artifact of this file:
 * - The probe loopback connect is expected host runtime traffic. Host blocking
 *   deliberately allows loopback, so its failed outcome proves neither blocking
 *   nor report attribution; only the non-loopback probe plus the rule counter do.
 * - A request without a Playwright frame (a service-worker request) cannot be
 *   attributed to the report surface or the workbench, so a zero report-surface
 *   count is never absolute proof of zero report traffic. Those requests are
 *   recorded as an explicit no-attribution gap, never silently folded into a
 *   claim.
 * - Native history runs on two recorded routes. The trusted profile uses the
 *   designer Undo; the restricted profile first asserts the product's own
 *   refusal (`Native history is unavailable in this read-only or restricted
 *   document.` with the exact unchanged post-edit bytes) and only then restores
 *   the source through the real user route: Code XML to the source editor, one
 *   native Ctrl+Z, save. Restricted designer history is never claimed accepted,
 *   and each profile provisions a fresh fixture (setup only, never proof).
 * - US6.4 attempts all six installed supported journeys in both the restricted
 *   and the trusted profile, and each profile records the journeys it did not
 *   complete as its own unvalidated scope: an authoring refusal is never
 *   counted as a completed journey, no artifact claims all-journey coverage by
 *   default, and this file does not claim T063 complete.
 */
import { test, expect } from 'playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BrowserContext, Frame, Locator, Page, Request } from 'playwright';
import {
  CAPTURE_COMPLETE_SCOPE,
  cleanWindowFailures,
  LOOPBACK_SCOPE,
  REPORT_ATTRIBUTION_SCOPE,
  REPORT_ZERO_SCOPE,
  attributeEvents,
  summarizeEvents,
  EXTENSION_ASSET_SCOPE,
  describeResourceTarget,
  extensionAssetPath,
  extensionAssetRoots,
  installedExtensionDirs,
  unclassifiedNetworkEvents,
} from './offline-assertions.js';
import {
  closeTrustEditor,
  commandAvailable,
  grantWorkspaceTrust,
  launchDesktop,
  readWorkspaceTrust,
  type DesktopDriver,
} from './driver.js';
import {
  hostObserverSkipReason,
  hostObserverUnsupported,
} from './host-observer-scope.js';
import {
  SEMANTIC_PROOF_LIMITATION,
  SecurityObserverUnsupportedError,
  createSecurityObserver,
  detectSecurityCapability,
  enableHostBlocking,
  newCanaryName,
  sanitizeTarget,
  sanitizeUrl,
  unexpectedEvents,
  type AllowedAccess,
  type HostBlocking,
  type SecurityCapability,
  type SecurityObservation,
} from './security-observer.js';

/** Captured before any test overrides TMPDIR, so canaries stay in the real OS tmp. */
const OS_TMPDIR = tmpdir();
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const DESIGNER_COMMAND = 'RDLC Code: Open Designer';
type ViewLabel = 'Report Structure' | 'Report Data' | 'Components';
type Profile = 'restricted' | 'trusted';
type JourneyName =
  | 'report-inspection'
  | 'textbox-creation'
  | 'table-creation'
  | 'dataset-creation'
  | 'unavailable-guard'
  | 'data-editing';

/** Full installed supported journey set; US6.4 runs it in both profiles. */
const ALL_JOURNEYS: readonly JourneyName[] = [
  'report-inspection',
  'textbox-creation',
  'table-creation',
  'dataset-creation',
  'unavailable-guard',
  'data-editing',
];

/**
 * How a journey restores the source after an edit. The restricted profile never
 * takes the designer route: DocumentSession.history refuses native history there
 * on purpose, and applyEdit keeps limited authoring working without it.
 */
type HistoryRoute = 'designer' | 'source-editor';

const HISTORY_ROUTE_STATEMENTS: Record<HistoryRoute, string> = {
  designer:
    'Trusted profile: the designer Undo is the one-step native history and it restored the exact source bytes.',
  'source-editor':
    'Restricted profile: the designer Undo refusal is asserted first (exact product reason, refused outcome, exact unchanged post-edit bytes) and only then the source is restored through the real user route (Code XML to the source editor, one native Ctrl+Z, save). Restricted designer history is never claimed accepted.',
};

/** The blocked probe carries a query so sanitization has something real to strip. */
const PROBE_LOOPBACK = 'https://127.0.0.1:1/offline-probe';
const BLOCKED_ORIGIN = 'https://rdlc-offline-blocked.invalid';
const BLOCKED_URL = `${BLOCKED_ORIGIN}/probe?token=offline-secret&query=private`;
/** Hostile fixture files copied into the own workspace, with their sources. */
const COPIED_FIXTURES: readonly (readonly [string, string])[] = [
  ['malformed.rdlc', 'xml/malformed.rdlc'],
  ['unsafe-dtd.rdlc', 'xml/unsafe-dtd.rdlc'],
  ['preserved.rdlc', 'datasets/preserved.rdlc'],
  ['local.rdlc', 'datasets/local.rdlc'],
];
const DATA_SETS =
  '<DataSets><DataSet Name="Orders"><Fields><Field Name="Id"><DataField>Id</DataField>' +
  '<rd:TypeName xmlns:rd="http://schemas.microsoft.com/SQLServer/reporting/reportdesigner">System.Int64</rd:TypeName>' +
  '</Field></Fields></DataSet></DataSets>';

/**
 * Real host attempts, executed by a terminal inside the Desktop process tree
 * and outside every report journey: the canary file, a missing file, a missing
 * executable, a loopback connect and a non-loopback connect that host blocking
 * must refuse.
 */
const PROBE_SCRIPT = [
  "const fs = require('node:fs');",
  "try { fs.openSync(process.argv[2], 'r'); } catch { /* canary */ }",
  "try { fs.openSync('/nonexistent/rdlc-offline-host-file', 'r'); } catch { /* missing */ }",
  "require('node:child_process').execFile('/nonexistent/rdlc-offline-host-exec', () => {});",
  "require('node:net').connect({ host: '127.0.0.1', port: 1 }).on('error', () => {});",
  "require('node:net').connect({ host: '203.0.113.9', port: 443 }).on('error', () => {});",
  'setTimeout(() => process.exit(0), 700);',
].join('\n');

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const unique = (values: readonly string[]): string[] => [...new Set(values)];
const record = (
  failures: string[],
  condition: unknown,
  message: string,
): void => {
  if (!condition) failures.push(message);
};
const desktopRoot = (): string =>
  process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
const artifactRoot = (root: string): string =>
  resolve(
    process.env.RDLC_DESKTOP_ARTIFACT_DIR ??
      resolve(root, '.vscode-test/desktop-artifacts'),
    'offline',
  );
const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
const readText = (path: string): Promise<string> => readFile(path, 'utf8');

async function writeArtifact(
  root: string,
  title: string,
  value: unknown,
): Promise<string> {
  const directory = artifactRoot(root);
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${title}.json`);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return path;
}

let cachedCapability: SecurityCapability | undefined;

/**
 * The genuine T010 capability check: both strace modes must have run their own
 * positive controls on this platform. An unsupported platform fails here with
 * its recorded requirement, before any journey and never as a skip; the gate
 * failure is written to the same artifact the test would have produced.
 */
async function gatedCapability(
  root: string,
  title: string,
): Promise<SecurityCapability> {
  try {
    cachedCapability ??= detectSecurityCapability();
    const capability = cachedCapability;
    const { native } = capability;
    if (!native.launch.supported)
      throw new SecurityObserverUnsupportedError(
        `Native launch capture is unsupported on ${native.platform}: ${native.launch.reason}`,
      );
    if (!native.attach.supported)
      throw new SecurityObserverUnsupportedError(
        `Native attach capture is unsupported on ${native.platform}: ${native.attach.reason}`,
      );
    for (const [mode, capture] of [
      ['launch', native.launch],
      ['attach', native.attach],
    ] as const) {
      const missing = Object.entries(capture.controls)
        .filter(([, enabled]) => !enabled)
        .map(([name]) => name);
      if (missing.length)
        throw new SecurityObserverUnsupportedError(
          `Native ${mode} positive controls are incomplete on ${native.platform}: missing ${missing.join(', ')}. ${capture.reason}`,
        );
    }
    if (native.tool !== 'strace')
      throw new SecurityObserverUnsupportedError(
        `Native capture did not run strace on ${native.platform}.`,
      );
    if (!capability.webview.supported)
      throw new SecurityObserverUnsupportedError(
        `Webview network observation is unsupported: ${capability.webview.reason}`,
      );
    if (
      !Object.values(capability.semantic).every(
        (state) => state === 'not-observable',
      )
    )
      throw new SecurityObserverUnsupportedError(
        'Query/entity/resource evaluation was reported observable without proof.',
      );
    if (!capability.limitations.includes(SEMANTIC_PROOF_LIMITATION))
      throw new SecurityObserverUnsupportedError(
        'The semantic proof limitation was dropped from the capability record.',
      );
    return capability;
  } catch (error) {
    const failures = [describeError(error)];
    await writeArtifact(root, title, {
      schemaVersion: 1,
      assertion: `tests/desktop/offline.spec.ts::${title}`,
      capabilityGate: failures[0],
      semanticScope: SEMANTIC_PROOF_LIMITATION,
      failures,
      validated: false,
    });
    throw error;
  }
}

interface FixtureSet {
  readonly dir: string;
  readonly tmpDir: string;
  readonly configDir: string;
  readonly hostile: { readonly path: string; readonly source: string };
  readonly canary: { readonly path: string; readonly name: string };
  readonly probePath: string;
  readonly env: Record<'TMPDIR' | 'XDG_CONFIG_HOME', string | undefined>;
}

async function hostileSource(
  root: string,
  canaryPath: string,
  canaryUrl: string,
): Promise<string> {
  const template = await readFile(
    resolve(root, 'tests/fixtures/security/canary-references.rdlc'),
    'utf8',
  );
  const substituted = template
    .replaceAll('__RDLC_CANARY_URL__', canaryUrl)
    .replaceAll('__RDLC_CANARY_PATH__', canaryPath);
  if (substituted.includes('__RDLC_CANARY'))
    throw new Error('The hostile fixture template was not fully substituted.');
  const source = substituted.replace('</Report>', `${DATA_SETS}</Report>`);
  if (source === substituted)
    throw new Error('The hostile fixture template has no </Report> close tag.');
  return source;
}

/**
 * The window's own fixture copy plus a canary that stays outside every
 * allowlist. Chromium/fontconfig probe configuration paths, so XDG_CONFIG_HOME
 * is redirected into the disposable tmp dir instead of widening the allowlist.
 */
async function createFixtureSet(root: string): Promise<FixtureSet> {
  await mkdir(resolve(root, '.vscode-test'), { recursive: true });
  const dir = await mkdtemp(resolve(root, '.vscode-test/offline-fixture-'));
  const canaryDir = await mkdtemp(join(OS_TMPDIR, 'rdlc-canary-'));
  const canaryName = newCanaryName();
  const canaryPath = join(canaryDir, canaryName);
  if (!sanitizeTarget(canaryPath).endsWith(canaryName))
    throw new Error(
      'The canary name would be redacted from event targets; use a shorter temporary directory.',
    );
  await writeFile(
    canaryPath,
    'rdlc offline canary: this file must never be read\n',
    'utf8',
  );
  const tmpDir = await mkdtemp(join(OS_TMPDIR, 'rdlc-desktop-tmp-'));
  const configDir = join(tmpDir, 'xdg-config');
  await mkdir(configDir, { recursive: true });
  const env: FixtureSet['env'] = {
    TMPDIR: process.env['TMPDIR'],
    XDG_CONFIG_HOME: process.env['XDG_CONFIG_HOME'],
  };
  process.env['TMPDIR'] = tmpDir;
  process.env['XDG_CONFIG_HOME'] = configDir;
  const hostilePath = join(dir, 'security.rdlc');
  await writeFile(
    hostilePath,
    await hostileSource(root, canaryPath, pathToFileURL(canaryPath).href),
    'utf8',
  );
  for (const [name, source] of COPIED_FIXTURES) {
    const origin = await readFile(
      resolve(root, 'tests/fixtures', source),
      'utf8',
    );
    const copy = join(dir, name);
    await copyFile(resolve(root, 'tests/fixtures', source), copy);
    if ((await readFile(copy, 'utf8')) !== origin)
      throw new Error(
        `The own fixture copy of ${name} differs from its source.`,
      );
  }
  const probePath = join(tmpDir, 'offline-probe.cjs');
  await writeFile(probePath, PROBE_SCRIPT, 'utf8');
  return {
    dir,
    tmpDir,
    configDir,
    hostile: { path: hostilePath, source: await readText(hostilePath) },
    canary: { path: canaryPath, name: canaryName },
    probePath,
    env,
  };
}

async function destroyFixtureSet(set: FixtureSet): Promise<void> {
  for (const [key, value] of Object.entries(set.env))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  await rm(set.dir, { recursive: true, force: true, maxRetries: 3 });
  await rm(set.tmpDir, { recursive: true, force: true, maxRetries: 3 });
  await rm(dirname(set.canary.path), { recursive: true, force: true });
}

/** The product extension folders installed in a packaged profile. */
function installedProductExtensionDirs(driver: DesktopDriver): string[] {
  if (driver.identity['packaged'] !== true) return [];
  const manifest = JSON.parse(
    readFileSync(
      join(desktopRoot(), 'apps', 'vscode-extension', 'package.json'),
      'utf8',
    ),
  ) as { publisher: string; name: string };
  return installedExtensionDirs(
    join(driver.profileDir, 'extensions'),
    manifest.publisher,
    manifest.name,
  );
}

/**
 * The extension sources Desktop loads: `--extensionDevelopmentPath` folders,
 * plus the installed product extension when the driver is packaged.
 */
function loadedExtensionDirs(driver: DesktopDriver): string[] {
  const launchArgs = Array.isArray(driver.identity['launchArgs'])
    ? (driver.identity['launchArgs'] as unknown[])
    : [];
  return [
    ...launchArgs
      .filter((arg): arg is string => typeof arg === 'string')
      .filter((arg) => arg.startsWith('--extensionDevelopmentPath='))
      .map((arg) => arg.slice('--extensionDevelopmentPath='.length)),
    ...installedProductExtensionDirs(driver),
  ];
}

/**
 * Raw-path allowlist for the host process tree: the disposable profile, the
 * dedicated tmp dir (including XDG_CONFIG_HOME), the own fixture copy and the
 * fontconfig cache may be written; the VS Code install, the loaded extension
 * sources and the X authority stay read-only. The canary directory and the OS
 * tmp root are deliberately absent.
 */
function allowedAccess(driver: DesktopDriver, set: FixtureSet): AllowedAccess {
  const install = dirname(driver.identity.executablePath);
  const extensionDirs = loadedExtensionDirs(driver);
  const home = homedir();
  return {
    open: [
      driver.profileDir,
      set.tmpDir,
      set.configDir,
      set.dir,
      join(home, '.cache/fontconfig'),
    ],
    readOnly: [
      install,
      ...extensionDirs,
      process.env['XAUTHORITY'] ?? join(home, '.Xauthority'),
    ],
    exec: [install],
    ...(process.env['PATH'] ? { path: process.env['PATH'] } : {}),
  };
}

interface ObservationWindow {
  readonly observation: SecurityObservation;
  /** http(s) requests issued by a non-workbench frame: the report surface. */
  readonly reportRequests: readonly string[];
  /**
   * Local `vscode-resource` requests for the extension's own webview bundle,
   * served from disk by the webview service worker: not network traffic and
   * not report traffic. Recorded and reported, never counted as report traffic.
   */
  readonly extensionAssetRequests: readonly string[];
  /** Workbench-main-frame requests: background traffic, recorded never asserted. */
  readonly backgroundRequests: readonly string[];
  /**
   * Requests whose Playwright frame is unavailable (service workers). They can
   * be neither attributed to the report surface nor proven not report traffic:
   * the explicit no-attribution gap behind every zero report-surface count.
   */
  readonly unattributedRequests: readonly string[];
}

/** Attribute each browser request to the report surface, the workbench, or neither. */
function trackRequests(driver: DesktopDriver): {
  stop(): {
    reportRequests: string[];
    extensionAssetRequests: string[];
    backgroundRequests: string[];
    unattributedRequests: string[];
  };
} {
  const assetRoots = extensionAssetRoots(loadedExtensionDirs(driver));
  const report: string[] = [];
  const extensionAssets: string[] = [];
  const background: string[] = [];
  const unattributed: string[] = [];
  const onRequest = (request: Request): void => {
    if (!/^https?:/.test(request.url())) return;
    const target = sanitizeUrl(request.url());
    let frame: Frame | null = null;
    try {
      frame = request.frame();
    } catch {
      // Service-worker requests carry no frame: attribution is impossible.
      frame = null;
    }
    if (frame === null) unattributed.push(target);
    else if (frame !== driver.page.mainFrame()) {
      // Only the extension's own bundle is exempt; any other local resource
      // (fixture dir, image, data) a report pulls in stays report traffic.
      const asset = extensionAssetPath(request.url(), assetRoots);
      if (asset === null)
        report.push(describeResourceTarget(request.url(), target));
      else extensionAssets.push(`${target}/${asset}`);
    } else background.push(target);
  };
  driver.context.on('request', onRequest);
  return {
    stop() {
      driver.context.off('request', onRequest);
      return {
        reportRequests: report,
        extensionAssetRequests: extensionAssets,
        backgroundRequests: background,
        unattributedRequests: unattributed,
      };
    },
  };
}

/**
 * Attach the observer to the Desktop process tree for one phase, run `action`
 * and stop. An action failure is never hidden by the observation itself.
 */
async function observationWindow(
  driver: DesktopDriver,
  capability: SecurityCapability,
  root: string,
  set: FixtureSet,
  action: () => Promise<void>,
): Promise<ObservationWindow> {
  const rootPid = capability.native.attach.supported
    ? driver.identity.processId
    : null;
  const observer = createSecurityObserver({
    rootPid,
    rootPidDetail: 'the owned Desktop process identity is unavailable',
    context: driver.context,
    capability,
    redactions: [driver.profileDir, root, driver.identity.executablePath],
    allowed: allowedAccess(driver, set),
    maxDurationMs: 300_000,
    maxEvents: 400_000,
    maxTraceBytes: 128 * 1024 * 1024,
  });
  const tracked = trackRequests(driver);
  try {
    await observer.start();
  } catch (startError) {
    tracked.stop();
    throw startError;
  }
  let error: unknown;
  try {
    await action();
    await driver.page.waitForTimeout(1_000);
  } catch (caught) {
    error = caught;
  }
  const observation = await observer.stop();
  const requests = tracked.stop();
  if (error) throw error;
  return { observation, ...requests };
}

/**
 * Zero report-triggered activity, with a non-vacuous observation behind it.
 * The checks live in `offline-assertions.ts` so a Node unit test can prove they
 * reject an unclassified outgoing network attempt; they run once per window
 * record, never once per suite.
 */
function assertCleanWindow(
  failures: string[],
  label: string,
  window: ObservationWindow,
  canaryName: string,
): void {
  failures.push(...cleanWindowFailures(label, window, canaryName));
}

function summarizeWindow(window: ObservationWindow): Record<string, unknown> {
  const counts: Record<string, number> = {};
  for (const event of window.observation.events)
    counts[event.channel] = (counts[event.channel] ?? 0) + 1;
  const unexpected = unexpectedEvents(window.observation.native.events);
  const unclassified = unclassifiedNetworkEvents(
    window.observation.native.events,
  );
  return {
    nativeMode: window.observation.native.mode,
    nativeCoverage: window.observation.native.state,
    webviewCoverage: window.observation.webview.state,
    captureComplete: window.observation.captureComplete,
    captureScope: CAPTURE_COMPLETE_SCOPE,
    durationMs: window.observation.durationMs,
    events: window.observation.events.length,
    channelCounts: counts,
    unexpected: unexpected.length,
    unexpectedSample: summarizeEvents(unexpected, { attribute: true }),
    unexpectedAttribution: attributeEvents(unexpected).slice(0, 60),
    unclassifiedNetwork: unclassified.length,
    unclassifiedNetworkSample: summarizeEvents(unclassified),
    reportSurfaceRequests: window.reportRequests,
    extensionAssetRequests: window.extensionAssetRequests,
    extensionAssetScope: EXTENSION_ASSET_SCOPE,
    backgroundRequests: window.backgroundRequests,
    unattributedRequests: window.unattributedRequests,
    reportZeroScope: `${window.unattributedRequests.length} request(s) had no Playwright frame: ${REPORT_ZERO_SCOPE}`,
    failures: window.observation.failures,
  };
}

const observationRecords = (windows: readonly ObservationWindow[]): string =>
  JSON.stringify(windows.map((window) => window.observation));

/** The blocked probe query must never survive into a serialized record. */
function sanitizationResult(
  windows: readonly ObservationWindow[],
): Record<string, unknown> {
  const serialized = observationRecords(windows);
  return {
    leaky:
      serialized.includes('offline-secret') ||
      serialized.includes('query=private'),
    recordsSha256: sha256(serialized),
  };
}

function blockingSummary(
  blocking: HostBlocking | null,
): Record<string, unknown> | null {
  if (!blocking) return null;
  return {
    mechanism: blocking.mechanism,
    ipv6: blocking.ipv6,
    ipv6Reason: blocking.ipv6Reason,
    ruleHits: blocking.hits,
    ipv6RuleHits: blocking.ipv6Hits,
  };
}

function capabilitySummary(
  capability: SecurityCapability,
): Record<string, unknown> {
  return {
    platform: capability.platform,
    tool: capability.native.tool,
    version: capability.native.version,
    launch: {
      supported: capability.native.launch.supported,
      reason: capability.native.launch.reason,
      controls: capability.native.launch.controls,
    },
    attach: {
      supported: capability.native.attach.supported,
      reason: capability.native.attach.reason,
      controls: capability.native.attach.controls,
    },
    webviewScope: capability.webview.scope,
    semantic: capability.semantic,
    limitations: capability.limitations,
  };
}

/** Shared scope statements written into every artifact of this file. */
function scopeRecord(): Record<string, string> {
  return {
    browserBlockingScope:
      'Playwright request routing aborts are supporting coverage only; host blocking is the iptables owner-uid REJECT rule verified by its packet counter.',
    loopbackScope: LOOPBACK_SCOPE,
    reportAttributionScope: REPORT_ATTRIBUTION_SCOPE,
    observationScope: `${CAPTURE_COMPLETE_SCOPE} Channel coverage comes from the positive controls (the SC-009 control window and the per-profile webview controls); a genuinely quiet window is never required to record a network event.`,
    semanticScope: SEMANTIC_PROOF_LIMITATION,
  };
}

/** Supporting coverage only: browser routing is never host-level blocking. */
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

async function blur(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
}

async function openFixture(driver: DesktopDriver, path: string): Promise<void> {
  const name = basename(path);
  await blur(driver.page);
  await driver.page.keyboard.press(`${MOD}+p`);
  await driver.page.keyboard.insertText(path);
  await driver.page
    .locator('.quick-input-widget:visible .monaco-list-row')
    .filter({ hasText: name })
    .first()
    .click();
  await expect(driver.page.locator('.quick-input-widget:visible')).toBeHidden();
  // `Open Designer` acts on the extension host's active text editor: wait until
  // this file's tab is the active one, or the command can open the designer of
  // the previously opened report instead.
  await expect(
    driver.page.locator('.part.editor .tabs-container .tab.active'),
  ).toContainText(name);
}

async function ensureDesigner(driver: DesktopDriver): Promise<Frame> {
  // A restricted window can reach the journey before the extension registers.
  if (!(await commandAvailable(driver.page, DESIGNER_COMMAND)))
    throw new Error(`${DESIGNER_COMMAND} is not registered in the window.`);
  await driver.command(DESIGNER_COMMAND);
  return driver.designerFrame();
}

const UNSUPPORTED_IMAGE =
  '[data-kind="preserved"][aria-label="Image (unsupported)"]';

/**
 * The designer frame that shows the hostile fixture, identified by its content.
 * Neither the frame `ensureDesigner` returns nor `designerFrame` can be trusted
 * here: right after `Open Designer` the only frame can still be the retained
 * one of a previously opened report, and once the new one exists both are
 * present (the old one hidden), so the frames are scanned again on every read.
 */
async function hostileDesigner(driver: DesktopDriver): Promise<Frame> {
  const { page } = driver;
  let shown: Frame | null = null;
  await expect
    .poll(
      async () => {
        shown = null;
        for (const frame of page.frames()) {
          if (frame === page.mainFrame()) continue;
          if (
            await frame
              .locator(UNSUPPORTED_IMAGE)
              .isVisible()
              .catch(() => false)
          ) {
            shown = frame;
            return true;
          }
        }
        return false;
      },
      {
        message: 'a designer frame shows the hostile fixture Image',
        timeout: 45_000,
      },
    )
    .toBe(true);
  return shown!;
}

async function focusView(
  driver: DesktopDriver,
  label: ViewLabel,
): Promise<void> {
  await driver.command(`Focus on ${label} View`);
}

async function filterComponents(
  driver: DesktopDriver,
  query: string,
): Promise<void> {
  await focusView(driver, 'Components');
  await driver.page.getByText('Components', { exact: true }).first().hover();
  await driver.page
    .getByLabel('RDLC Code: Filter Components', { exact: true })
    .click();
  const input = driver.page.locator(
    '.quick-input-widget:visible .quick-input-box input',
  );
  await input.fill(query);
  await input.press('Enter');
  await expect(driver.page.locator('.quick-input-widget:visible')).toBeHidden();
}

/** One Ctrl+S followed by an independent byte-exact read of the report. */
async function savedSource(
  driver: DesktopDriver,
  path: string,
  expected: string,
): Promise<void> {
  await driver.page.keyboard.press(`${MOD}+s`);
  await expect.poll(() => readText(path), { timeout: 45_000 }).toBe(expected);
}

/**
 * Save a creation and return the new bytes. The created item is awaited first
 * (the designer announces it once the edit is accepted), then the file is read
 * until it holds the created block. Ctrl+S is repeated only while the editor
 * is still dirty: saving a clean editor is a no-op.
 */
async function creationSaved(
  driver: DesktopDriver,
  path: string,
  created: { name: string; block: RegExp },
): Promise<string> {
  const { page } = driver;
  const frame = await driver.designerFrame();
  await expect(
    frame.locator('.feedback').getByText(`Created ${created.name}.`, {
      exact: true,
    }),
  ).toHaveCount(1);
  const dirty = page.locator('.monaco-workbench .tab.dirty');
  await expect
    .poll(
      async () => {
        if (created.block.test(await readText(path))) return true;
        if ((await dirty.count()) > 0) await page.keyboard.press(`${MOD}+s`);
        return false;
      },
      { timeout: 45_000 },
    )
    .toBe(true);
  return readText(path);
}

/**
 * The restricted cleanup route: reveal this document's source through the
 * public Code XML action, prove the focused editor really is that document,
 * then run one native editor Undo and save. It restores bytes; it never claims
 * the designer's history was accepted.
 */
async function undoInSourceEditor(
  driver: DesktopDriver,
  path: string,
  original: string,
): Promise<void> {
  const { page } = driver;
  const name = basename(path);
  const frame = await driver.designerFrame();
  await frame.getByRole('button', { name: 'Code XML', exact: true }).click();
  const activeTab = page.locator('.part.editor .tabs-container .tab.active');
  await expect(activeTab).toHaveCount(1);
  // The active tab is exactly this report, so the shortcut cannot reach
  // another document that happens to be open beside it.
  await expect(activeTab).toContainText(name);
  const sourceEditorActive = async (): Promise<boolean> =>
    /\bLn \d+, Col \d+\b/.test(
      await page
        .locator('.part.statusbar')
        .innerText()
        .catch(() => ''),
    );
  await expect.poll(sourceEditorActive, { timeout: 20_000 }).toBe(true);
  // Focus the proven tab before the shortcut, never an unverified editor.
  await activeTab.click();
  await page.keyboard.press(`${MOD}+z`);
  await page.keyboard.press(`${MOD}+s`);
  await expect.poll(() => readText(path), { timeout: 45_000 }).toBe(original);
  // Reopen the designer for the next journey and prove it took the focus back.
  await ensureDesigner(driver);
  await expect.poll(sourceEditorActive, { timeout: 20_000 }).toBe(false);
}

/**
 * One native history step after an edit, on the profile's recorded route. The
 * restricted route asserts the product's own refusal before it restores the
 * source through the real user route, so a refusal is never counted as an
 * accepted designer undo.
 */
async function undoSaved(env: JourneyContext): Promise<void> {
  const { driver, hostile, source } = env;
  const edited = await readText(hostile);
  const frame = await driver.designerFrame();
  await frame.getByRole('button', { name: 'Undo', exact: true }).click();
  if (env.history === 'designer') {
    await savedSource(driver, hostile, source);
    return;
  }
  // DocumentSession.history refuses `!workspace.isTrusted` on purpose; the
  // refusal itself is the expected product behaviour here.
  const refusal = frame.locator('#report-refusal');
  await expect(refusal).toBeVisible();
  expect(await refusal.count(), 'the refusal is announced once').toBe(1);
  await expect(refusal).toContainText(
    'Native history is unavailable in this read-only or restricted document.',
  );
  await expect(refusal).toHaveAttribute('data-accepted', 'false');
  // The refused Undo changed nothing: the exact post-edit bytes stay on disk.
  expect(await readText(hostile)).toBe(edited);
  await undoInSourceEditor(driver, hostile, source);
}

interface JourneyContext {
  readonly driver: DesktopDriver;
  readonly hostile: string;
  readonly source: string;
  readonly history: HistoryRoute;
}

async function journeyInspection(env: JourneyContext): Promise<void> {
  const { driver } = env;
  await openFixture(driver, env.hostile);
  await ensureDesigner(driver);
  // The hostile fixture really loaded: its external image never decodes.
  const frame = await hostileDesigner(driver);
  await focusView(driver, 'Report Structure');
  await expect(
    driver.page.getByRole('treeitem', { name: /CanaryImage/ }),
  ).toBeVisible();
  await focusView(driver, 'Report Data');
  await expect(
    driver.page.getByRole('treeitem', { name: /CanarySource/ }),
  ).toBeVisible();
  await expect(
    driver.page.getByRole('treeitem', { name: /^Field: Id/ }),
  ).toBeVisible();
  await focusView(driver, 'Components');
  await expect(
    driver.page.getByRole('treeitem', { name: /^Textbox, Insert/ }),
  ).toBeVisible();
  // Compact designer fallback reachable from the report surface.
  if (!(await frame.locator('[data-card="Textbox"]').isVisible()))
    await frame
      .getByRole('button', { name: 'Components', exact: true })
      .click();
  await expect(frame.locator('[data-card="Textbox"]')).toBeVisible();
  expect(await readText(env.hostile)).toBe(env.source);
}

async function journeyTextbox(env: JourneyContext): Promise<void> {
  const { driver } = env;
  await filterComponents(driver, 'Textbox');
  await driver.page.getByRole('treeitem', { name: /^Textbox, Insert/ }).click();
  const created = await creationSaved(driver, env.hostile, {
    name: 'Textbox1',
    block: /<Textbox Name="Textbox1">[\s\S]*?<\/Textbox>/,
  });
  const block = created.match(
    /<Textbox Name="Textbox1">[\s\S]*?<\/Textbox>/,
  )?.[0];
  expect(block, 'the created Textbox1 XML block').toBeTruthy();
  expect(created.replace(block!, '')).toBe(env.source);
  // Canvas shows the created item through the accepted native selection.
  await focusView(driver, 'Report Structure');
  await driver.page
    .getByRole('treeitem', { name: /^Textbox: Textbox1/ })
    .click();
  const frame = await driver.designerFrame();
  await expect(frame.locator('.selection-frame')).toHaveCount(1);
  await undoSaved(env);
}

async function journeyTable(env: JourneyContext): Promise<void> {
  const { driver } = env;
  await filterComponents(driver, 'tAbL');
  await driver.page.getByRole('treeitem', { name: /^Table, Insert/ }).click();
  const created = await creationSaved(driver, env.hostile, {
    name: 'Table1',
    block: /<Tablix Name="Table1">[\s\S]*?<\/Tablix>/,
  });
  const block = created.match(/<Tablix Name="Table1">[\s\S]*?<\/Tablix>/)?.[0];
  expect(block, 'the created Table1 XML block').toBeTruthy();
  expect(created.replace(block!, '')).toBe(env.source);
  await undoSaved(env);
}

async function journeyDataset(env: JourneyContext): Promise<void> {
  const { driver } = env;
  await filterComponents(driver, 'Dataset');
  await driver.page.getByRole('treeitem', { name: /^Dataset, Insert/ }).click();
  const created = await creationSaved(driver, env.hostile, {
    name: 'DataSet1',
    block: /<DataSet Name="DataSet1">[\s\S]*?<\/DataSet>/,
  });
  const block = created.match(
    /<DataSet Name="DataSet1">[\s\S]*?<\/DataSet>/,
  )?.[0];
  expect(block, 'the created DataSet1 XML block').toBeTruthy();
  expect(created.replace(block!, '')).toBe(env.source);
  await undoSaved(env);
}

/** Refused activation must write nothing: the guard, not a skip. */
async function journeyUnavailableGuard(env: JourneyContext): Promise<void> {
  const { driver } = env;
  await filterComponents(driver, 'Image');
  const row = driver.page.getByRole('treeitem', {
    name: /^Image, Unavailable\./,
  });
  await expect(row).toBeVisible();
  await row.click();
  await driver.page.keyboard.press('Enter');
  expect(await readText(env.hostile)).toBe(env.source);
}

async function journeyDataEditing(env: JourneyContext): Promise<void> {
  const { driver } = env;
  await focusView(driver, 'Report Data');
  await driver.page.getByRole('treeitem', { name: /^Field: Id/ }).click();
  await driver.page
    .getByRole('treeitem', { name: /^Field: Id, Selected/ })
    .click({ button: 'right' });
  await driver.page.keyboard.press('End');
  await driver.page.keyboard.press('Enter');
  await expect(
    driver.page.getByRole('menuitem', { name: /Properties/ }),
  ).toBeHidden();
  const frame = await driver.designerFrame();
  const fieldType = frame.getByRole('combobox', {
    name: 'Field type',
    exact: true,
  });
  await expect(fieldType).toHaveValue('Int64');
  // Guard: field editing keeps no stale canvas rectangle behind.
  await expect(frame.locator('.selection-frame')).toHaveCount(0);
  const expected = env.source.replace(
    '>System.Int64</rd:TypeName>',
    '>System.String</rd:TypeName>',
  );
  expect(expected).not.toBe(env.source);
  await fieldType.selectOption('text');
  await frame.getByRole('button', { name: 'Set type', exact: true }).click();
  await expect(fieldType).toHaveValue('text');
  await savedSource(driver, env.hostile, expected);
  await undoSaved(env);
}

const JOURNEY_RUNNERS: Record<
  JourneyName,
  (env: JourneyContext) => Promise<void>
> = {
  'report-inspection': journeyInspection,
  'textbox-creation': journeyTextbox,
  'table-creation': journeyTable,
  'dataset-creation': journeyDataset,
  'unavailable-guard': journeyUnavailableGuard,
  'data-editing': journeyDataEditing,
};

/** Runs the requested journeys and reports exactly the ones that completed. */
async function runJourneys(
  env: JourneyContext,
  names: readonly JourneyName[],
): Promise<JourneyName[]> {
  const done: JourneyName[] = [];
  for (const name of names) {
    await JOURNEY_RUNNERS[name](env);
    done.push(name);
  }
  return done;
}

/**
 * Measured journey scope for one profile. Whatever did not complete is
 * recorded as unvalidated, never as an accepted pass and never as an
 * "unsupported" excuse; no artifact claims T063 complete on its own.
 */
function journeyScope(
  completed: readonly JourneyName[],
): Record<string, unknown> {
  const unvalidated = ALL_JOURNEYS.filter((name) => !completed.includes(name));
  return {
    attempted: ALL_JOURNEYS.length,
    completed: completed.length,
    completedNames: [...completed],
    unvalidated: { count: unvalidated.length, names: unvalidated },
    statement: unvalidated.length
      ? `${unvalidated.length} of the ${ALL_JOURNEYS.length} installed supported journeys did not complete here: ${unvalidated.join(', ') || 'none'}. They stay unvalidated for this profile, so neither this artifact nor T063 claims all-journey coverage.`
      : `All ${ALL_JOURNEYS.length} installed supported journeys completed in this profile; this artifact alone still does not claim T063 complete.`,
  };
}

function probeCommand(set: FixtureSet): string {
  const parts = [process.execPath, set.probePath, set.canary.path];
  for (const part of parts)
    if (/['\\\n]/.test(part))
      throw new Error('The probe command must be shell-quote safe.');
  return parts.map((part) => `'${part}'`).join(' ');
}

async function runHostProbe(
  driver: DesktopDriver,
  command: string,
): Promise<void> {
  await driver.command('Terminal: Create New Terminal');
  const terminal = driver.page.locator('.terminal-wrapper').first();
  await terminal.waitFor({ state: 'visible', timeout: 20_000 });
  await terminal.click();
  await driver.page.waitForTimeout(1_500);
  await driver.page.keyboard.insertText(command);
  await driver.page.keyboard.press('Enter');
  await driver.page.waitForTimeout(3_000);
  await driver.command('Terminal: Kill the Terminal').catch(() => {
    // Cleanup only: the probe itself is asserted from the observation.
  });
}

/** Webview listener positive controls: one allowed, one refused request. */
async function webviewControls(
  driver: DesktopDriver,
): Promise<{ loopback: string; blocked: string }> {
  return driver.page.evaluate(
    async ({ loopback, blocked }) => {
      const attempt = (url: string) =>
        fetch(url, { mode: 'no-cors' }).then(
          () => 'fulfilled' as const,
          () => 'rejected' as const,
        );
      return {
        loopback: await attempt(loopback),
        blocked: await attempt(blocked),
      };
    },
    { loopback: PROBE_LOOPBACK, blocked: BLOCKED_URL },
  );
}

interface OfflineSession {
  readonly root: string;
  readonly capability: SecurityCapability;
  readonly driver: DesktopDriver;
  readonly fixture: FixtureSet;
  /** Set by `provisionOffline`; recorded even when a later step fails. */
  trust: { initial: boolean | null; granted: boolean | null };
  isolation: Record<string, unknown>;
  blocking: HostBlocking | null;
  blocked: { blocked: number; hosts: string[] } | null;
  close(): Promise<void>;
}

/**
 * Open one disposable window of its own: download, profile, own fixture
 * workspace and the real restricted state. Every offline test opens and closes
 * its own session, so no test depends on another one or on the run order.
 * Trust, blocking and journeys follow in `provisionOffline` and the test.
 */
async function openOfflineSession(
  root: string,
  capability: SecurityCapability,
): Promise<OfflineSession> {
  const fixture = await createFixtureSet(root);
  let driver: DesktopDriver;
  try {
    driver = await launchDesktop({
      root,
      version: process.env.VSCODE_VERSION ?? '1.142.0',
      packaged: process.env.RDLC_DESKTOP_PACKAGED === 'true',
      // Test-only trust probe; the product extension is never replaced by it.
      testHarness: true,
      artifactDir: artifactRoot(root),
      workspaceDir: fixture.dir,
    });
  } catch (error) {
    try {
      await destroyFixtureSet(fixture);
    } catch {
      // The launch error is the one worth reporting.
    }
    throw error;
  }
  let closed = false;
  const session: OfflineSession = {
    root,
    capability,
    driver,
    fixture,
    trust: { initial: null, granted: null },
    isolation: {},
    blocking: null,
    blocked: null,
    async close() {
      if (closed) return;
      closed = true;
      // Every step runs even when an earlier one fails: a stranded rule or
      // window must never hide the remaining cleanup.
      const errors: string[] = [];
      if (this.blocking) {
        try {
          this.blocking.release();
        } catch (error) {
          errors.push(`host blocking release: ${describeError(error)}`);
        }
        this.blocking = null;
      }
      try {
        await driver.close();
      } catch (error) {
        errors.push(`Desktop shutdown: ${describeError(error)}`);
      }
      try {
        await destroyFixtureSet(fixture);
      } catch (error) {
        errors.push(`fixture cleanup: ${describeError(error)}`);
      }
      if (errors.length) throw new Error(errors.join(' '));
    },
  };
  return session;
}

/**
 * Setup shared by every offline test (FR-030): the real trust grant, the
 * isolation checks, then browser and host outbound blocking. Provisioning
 * (download, profile, VSIX, trust) is complete before anything is blocked.
 * Check failures are recorded, not thrown, so the caller keeps its evidence.
 */
async function provisionOffline(
  session: OfflineSession,
  failures: string[],
): Promise<{
  blocked: { blocked: number; hosts: string[] };
  blocking: HostBlocking;
}> {
  const { driver, fixture, root, trust } = session;

  // Real trust state through the public API; trust is never forced by flags.
  const initial = await readWorkspaceTrust(driver);
  trust.initial = initial;
  record(
    failures,
    initial === false,
    `The fresh restricted profile reported isTrusted=${initial}.`,
  );
  if (!initial) {
    await grantWorkspaceTrust(driver);
    await closeTrustEditor(driver);
  }
  const granted = await readWorkspaceTrust(driver);
  trust.granted = granted;
  record(
    failures,
    granted === true,
    `Workspace trust stayed ${granted} after the real editor grant.`,
  );

  const launchArgs =
    (driver.identity['launchArgs'] as string[] | undefined) ?? [];
  session.isolation = { workspace: driver.identity.workspace, launchArgs };
  record(
    failures,
    driver.identity.workspace === fixture.dir,
    'The window did not open the own fixture copy as its workspace.',
  );
  record(
    failures,
    fixture.dir.startsWith(resolve(root, '.vscode-test')),
    `The fixture workspace escaped the disposable directory: ${fixture.dir}`,
  );
  record(
    failures,
    !launchArgs.some((arg) => /workspace-trust/i.test(arg)),
    'A launch flag forced workspace trust.',
  );
  record(
    failures,
    !launchArgs.includes(root),
    'The repository root was opened as the workspace.',
  );

  // Provisioning (download, profile, VSIX, trust) is complete: block now.
  const blocked = await blockOutbound(driver.context);
  session.blocked = blocked;
  const blocking = await enableHostBlocking();
  session.blocking = blocking;
  return { blocked, blocking };
}

/** Close the session of one test; a cleanup error fails that test. */
async function closeOfflineSession(
  session: OfflineSession | null,
  failures: string[],
): Promise<void> {
  if (!session) return;
  try {
    await session.close();
  } catch (error) {
    failures.push(`offline session cleanup: ${describeError(error)}`);
  }
}

test('FR-030-trust', async () => {
  test.setTimeout(600_000);
  test.skip(hostObserverUnsupported(), hostObserverSkipReason() ?? '');
  const failures: string[] = [];
  const root = desktopRoot();
  const capability = await gatedCapability(root, 'FR-030-trust');
  const windows: ObservationWindow[] = [];
  let session: OfflineSession | null = null;
  try {
    session = await openOfflineSession(root, capability);
    const { driver, fixture } = session;
    await provisionOffline(session, failures);

    windows.push(
      await observationWindow(driver, capability, root, fixture, async () => {
        await openFixture(driver, join(fixture.dir, 'preserved.rdlc'));
        await ensureDesigner(driver);
        await focusView(driver, 'Report Data');
        await expect(
          driver.page.getByRole('treeitem', {
            name: 'DataSet: Existing',
            exact: true,
          }),
        ).toBeVisible();
        expect(await readText(join(fixture.dir, 'preserved.rdlc'))).toBe(
          await readFile(
            resolve(root, 'tests/fixtures/datasets/preserved.rdlc'),
            'utf8',
          ),
        );
        // The trust API keeps answering correctly while offline and blocked.
        record(
          failures,
          (await readWorkspaceTrust(driver)) === true,
          'Workspace trust changed while blocked offline.',
        );
      }),
    );
    assertCleanWindow(
      failures,
      'FR-030 offline window',
      windows[0]!,
      fixture.canary.name,
    );
  } catch (error) {
    failures.push(describeError(error));
  } finally {
    // Read before the cleanup releases the host rule.
    const hostBlocking = blockingSummary(session?.blocking ?? null);
    const browserBlocking = session?.blocked ?? null;
    await closeOfflineSession(session, failures);
    try {
      await writeArtifact(root, 'FR-030-trust', {
        schemaVersion: 1,
        assertion: 'tests/desktop/offline.spec.ts::FR-030-trust',
        capability: capabilitySummary(capability),
        trust: session?.trust ?? { initial: null, granted: null },
        isolation: session?.isolation ?? {},
        hostBlocking,
        browserBlocking,
        windows: windows.map(summarizeWindow),
        observationRecordsSha256: sha256(observationRecords(windows)),
        ...scopeRecord(),
        failures,
        validated: failures.length === 0,
      });
    } catch (error) {
      failures.push(`artifact: ${describeError(error)}`);
    }
  }
  if (failures.length)
    throw new Error(
      `FR-030 offline trust journeys failed: ${unique(failures).join(' ')}`,
    );
});

test('SC-009-monitored-offline', async () => {
  test.setTimeout(900_000);
  test.skip(hostObserverUnsupported(), hostObserverSkipReason() ?? '');
  const failures: string[] = [];
  const root = desktopRoot();
  const capability = await gatedCapability(root, 'SC-009-monitored-offline');
  const windows: ObservationWindow[] = [];
  let journeys: string[] = [];
  const controls: {
    webview: { loopback: string; blocked: string } | null;
    hostProbe: boolean;
  } = { webview: null, hostProbe: false };
  let loopbackEvidence: Record<string, unknown> = {};
  let session: OfflineSession | null = null;
  try {
    session = await openOfflineSession(root, capability);
    const { driver, fixture } = session;
    const { blocked, blocking } = await provisionOffline(session, failures);

    // Positive controls, outside every report journey, before the journeys run.
    windows.push(
      await observationWindow(driver, capability, root, fixture, async () => {
        controls.webview = await webviewControls(driver);
        await runHostProbe(driver, probeCommand(fixture));
        controls.hostProbe = true;
      }),
    );
    const control = windows[0]!;
    const events = control.observation.native.events;
    record(
      failures,
      events.some(
        (event) =>
          event.channel === 'file' &&
          event.target.includes(fixture.canary.name) &&
          event.unexpected === true,
      ),
      'the harness-only canary open was not observed and classified unexpected.',
    );
    record(
      failures,
      events.some(
        (event) =>
          event.channel === 'file' &&
          event.outcome === 'failed' &&
          event.target.includes('rdlc-offline-host-file') &&
          event.unexpected === true,
      ),
      'the missing-file attempt was not observed.',
    );
    record(
      failures,
      events.some(
        (event) =>
          event.channel === 'exec' &&
          event.outcome === 'failed' &&
          event.target === 'rdlc-offline-host-exec' &&
          event.unexpected === true,
      ),
      'the execve attempt was not observed.',
    );
    // Loopback scope: this control window runs outside every report journey,
    // and the host rule exempts 127.0.0.0/8, so the probe loopback connect is
    // expected host traffic that is neither blocked nor report-attributed.
    const loopback = events.filter(
      (event) => event.channel === 'network' && event.target === '127.0.0.1:1',
    );
    loopbackEvidence = {
      attempts: loopback.length,
      classifiedUnexpected: loopback.filter(
        (event) => event.unexpected === true,
      ).length,
      hostRuleExemptsLoopback: true,
      attributedToReport: false,
      recordedOutsideReportJourneys: true,
      statement: LOOPBACK_SCOPE,
    };
    record(
      failures,
      loopback.length > 0,
      'the loopback connect attempt was not observed.',
    );
    record(
      failures,
      loopback.every((event) => event.unexpected !== true),
      'the probe loopback connect was classified unexpected although host blocking deliberately exempts loopback.',
    );
    const unclassified = unclassifiedNetworkEvents(events);
    record(
      failures,
      unclassified.length === 0,
      `${unclassified.length} unclassified outgoing network attempt(s) in the control window: ${summarizeEvents(unclassified)}`,
    );
    record(
      failures,
      events.some(
        (event) =>
          event.channel === 'network' &&
          event.outcome === 'failed' &&
          event.target === '203.0.113.9:443' &&
          event.unexpected === true,
      ),
      'the non-loopback connect was not observed as refused by host blocking.',
    );
    record(
      failures,
      new Set(
        events
          .map((event) => event.pid)
          .filter((pid): pid is number => pid !== null),
      ).size > 1,
      'host capture did not include the short-lived probe descendant.',
    );
    record(
      failures,
      blocking.hits > 0,
      `the host blocking rule matched no probe packet (hits=${blocking.hits}).`,
    );
    const webviewEvents = control.observation.webview.events;
    record(
      failures,
      controls.webview?.loopback === 'rejected' &&
        webviewEvents.some((event) => event.target === 'https://127.0.0.1:1'),
      'the allowed loopback request was not captured by the webview listener.',
    );
    record(
      failures,
      controls.webview?.blocked === 'rejected' &&
        webviewEvents.some(
          (event) =>
            event.target === BLOCKED_ORIGIN &&
            event.outcome === 'failed' &&
            event.error === 'net::ERR_BLOCKED_BY_CLIENT',
        ),
      'the refused non-loopback request was not captured by the webview listener.',
    );
    record(
      failures,
      blocked.blocked >= 1 &&
        blocked.hosts.includes('rdlc-offline-blocked.invalid'),
      `the refused request was not counted (blocked=${blocked.blocked}).`,
    );
    record(
      failures,
      control.observation.captureComplete,
      `control capture was incomplete: ${control.observation.failures.join(' ')}`,
    );

    // Clean report journey phase: the hostile fixture, every supported journey.
    windows.push(
      await observationWindow(driver, capability, root, fixture, async () => {
        journeys = await runJourneys(
          {
            driver,
            hostile: fixture.hostile.path,
            source: fixture.hostile.source,
            // provisionOffline granted real trust (FR-030) in this session.
            history: 'designer',
          },
          ALL_JOURNEYS,
        );
      }),
    );
    assertCleanWindow(
      failures,
      'SC-009 journey window',
      windows[1]!,
      fixture.canary.name,
    );
    record(
      failures,
      (await readText(fixture.hostile.path)) === fixture.hostile.source,
      'the hostile fixture did not end byte-identical to its original source.',
    );
    record(
      failures,
      journeys.length === ALL_JOURNEYS.length,
      `only ${journeys.length}/${ALL_JOURNEYS.length} installed supported journeys ran: ${journeys.join(', ')}`,
    );
  } catch (error) {
    failures.push(describeError(error));
  } finally {
    // Read before the cleanup releases the host rule.
    const hostBlocking = blockingSummary(session?.blocking ?? null);
    const browserBlocking = session?.blocked ?? null;
    await closeOfflineSession(session, failures);
    try {
      await writeArtifact(root, 'SC-009-monitored-offline', {
        schemaVersion: 1,
        assertion: 'tests/desktop/offline.spec.ts::SC-009-monitored-offline',
        capability: capabilitySummary(capability),
        hostBlocking,
        browserBlocking,
        positiveControls: controls,
        loopback: loopbackEvidence,
        windows: windows.map(summarizeWindow),
        journeys: { count: journeys.length, names: journeys },
        observationRecordsSha256: sha256(observationRecords(windows)),
        sanitization: sanitizationResult(windows),
        ...scopeRecord(),
        failures,
        validated: failures.length === 0,
      });
    } catch (error) {
      failures.push(`artifact: ${describeError(error)}`);
    }
  }
  if (failures.length)
    throw new Error(
      `SC-009 monitored offline journeys failed: ${unique(failures).join(' ')}`,
    );
});

interface PayloadPattern {
  readonly label: string;
  readonly value: string;
}

/** Query/expression/connect payloads that must never reach routine output. */
function payloadPatterns(fixture: FixtureSet): PayloadPattern[] {
  return [
    { label: 'hostile-connect-string', value: fixture.canary.path },
    {
      label: 'hostile-image-url',
      value: pathToFileURL(fixture.canary.path).href,
    },
    { label: 'hostile-connect-key', value: '<ConnectString>' },
    { label: 'preserved-query', value: 'SELECT untouched' },
    { label: 'preserved-expression', value: '=Fields!Known.Value' },
    { label: 'preserved-column', value: 'application_column' },
  ];
}

test('FR-014-no-fetch', async () => {
  test.setTimeout(600_000);
  test.skip(hostObserverUnsupported(), hostObserverSkipReason() ?? '');
  const failures: string[] = [];
  const root = desktopRoot();
  const capability = await gatedCapability(root, 'FR-014-no-fetch');
  const windows: ObservationWindow[] = [];
  const scan = {
    patterns: [] as string[],
    samples: [] as string[],
    matches: [] as { where: string; label: string }[],
    tooltipObserved: false,
  };
  let session: OfflineSession | null = null;
  try {
    session = await openOfflineSession(root, capability);
    const { driver, fixture } = session;
    await provisionOffline(session, failures);
    const samples: { where: string; text: string }[] = [];
    windows.push(
      await observationWindow(driver, capability, root, fixture, async () => {
        await openFixture(driver, join(fixture.dir, 'local.rdlc'));
        await ensureDesigner(driver);
        await focusView(driver, 'Report Data');
        await expect(
          driver.page.getByRole('treeitem', { name: /^Field: Label/ }),
        ).toBeVisible();
        await expect(
          driver.page.getByRole('treeitem', { name: /^Field:/ }),
        ).toHaveCount(7);

        await openFixture(driver, join(fixture.dir, 'preserved.rdlc'));
        await focusView(driver, 'Report Data');
        await expect(
          driver.page.getByRole('treeitem', {
            name: 'DataSet: Existing',
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          driver.page.getByRole('treeitem', { name: /Calculated/ }),
        ).toBeVisible();
        expect(await readText(join(fixture.dir, 'preserved.rdlc'))).toBe(
          await readFile(
            resolve(root, 'tests/fixtures/datasets/preserved.rdlc'),
            'utf8',
          ),
        );

        // Hostile definitions inspected as bounded, inert text.
        await openFixture(driver, fixture.hostile.path);
        await ensureDesigner(driver);
        await focusView(driver, 'Report Data');
        await expect(
          driver.page.getByRole('treeitem', { name: /CanarySource/ }),
        ).toBeVisible();
        const frame = await hostileDesigner(driver);
        expect(await readText(fixture.hostile.path)).toBe(
          fixture.hostile.source,
        );

        samples.push({
          where: 'workbench-aria',
          text: await driver.page.ariaSnapshot(),
        });
        samples.push({
          where: 'designer-aria',
          text: await frame.locator('body').ariaSnapshot(),
        });
        // Routine tooltips are scanned too: a bounded flag, never a payload.
        const row = driver.page.getByRole('treeitem', { name: /CanarySource/ });
        await row.hover();
        const hover = driver.page.locator('.monaco-hover');
        await hover.waitFor({ state: 'visible', timeout: 10_000 });
        scan.tooltipObserved = true;
        samples.push({
          where: 'data-source-tooltip',
          text: await hover.innerText(),
        });
        await driver.page.keyboard.press('Escape');
      }),
    );
    const patterns = payloadPatterns(fixture);
    scan.patterns = patterns.map(
      (pattern) => `${pattern.label}:${sha256(pattern.value).slice(0, 16)}`,
    );
    scan.samples = samples.map((sample) => sample.where);
    for (const sample of samples)
      for (const pattern of patterns)
        if (sample.text.includes(pattern.value))
          scan.matches.push({ where: sample.where, label: pattern.label });
    record(
      failures,
      scan.tooltipObserved,
      'the data source routine tooltip was never shown, so its payload scan is vacuous.',
    );
    record(
      failures,
      scan.matches.length === 0,
      `routine output leaked ${scan.matches.length} payload(s): ${scan.matches
        .map((match) => `${match.where}/${match.label}`)
        .join(', ')}`,
    );
    assertCleanWindow(
      failures,
      'FR-014 window',
      windows[0]!,
      fixture.canary.name,
    );
    record(
      failures,
      (await readText(join(fixture.dir, 'local.rdlc'))) ===
        (await readFile(
          resolve(root, 'tests/fixtures/datasets/local.rdlc'),
          'utf8',
        )),
      'the seven-types fixture changed during inspection.',
    );
    record(
      failures,
      (await readText(fixture.hostile.path)) === fixture.hostile.source,
      'the hostile fixture changed during inspection.',
    );
  } catch (error) {
    failures.push(describeError(error));
  } finally {
    await closeOfflineSession(session, failures);
    try {
      await writeArtifact(root, 'FR-014-no-fetch', {
        schemaVersion: 1,
        assertion: 'tests/desktop/offline.spec.ts::FR-014-no-fetch',
        capability: capabilitySummary(capability),
        windows: windows.map(summarizeWindow),
        payloadExclusion: scan,
        observationRecordsSha256: sha256(observationRecords(windows)),
        ...scopeRecord(),
        failures,
        validated: failures.length === 0,
      });
    } catch (error) {
      failures.push(`artifact: ${describeError(error)}`);
    }
  }
  if (failures.length)
    throw new Error(
      `FR-014 inert inspection failed: ${unique(failures).join(' ')}`,
    );
});

const pane = (page: Page, label: string): Locator =>
  page
    .locator('.pane')
    .filter({ has: page.locator('.pane-header', { hasText: label }) });

test('EDGE-05-inert', async () => {
  test.setTimeout(600_000);
  test.skip(hostObserverUnsupported(), hostObserverSkipReason() ?? '');
  const failures: string[] = [];
  const root = desktopRoot();
  const capability = await gatedCapability(root, 'EDGE-05-inert');
  const windows: ObservationWindow[] = [];
  const states: Record<string, string> = {};
  let session: OfflineSession | null = null;
  try {
    session = await openOfflineSession(root, capability);
    const { driver, fixture } = session;
    await provisionOffline(session, failures);
    const malformed = join(fixture.dir, 'malformed.rdlc');
    const unsafe = join(fixture.dir, 'unsafe-dtd.rdlc');
    const malformedSource = await readFile(
      resolve(root, 'tests/fixtures/xml/malformed.rdlc'),
      'utf8',
    );
    const unsafeSource = await readFile(
      resolve(root, 'tests/fixtures/xml/unsafe-dtd.rdlc'),
      'utf8',
    );
    windows.push(
      await observationWindow(driver, capability, root, fixture, async () => {
        // A prior actionable snapshot must not survive the invalid document.
        await openFixture(driver, fixture.hostile.path);
        await ensureDesigner(driver);
        await focusView(driver, 'Report Structure');
        await expect(
          driver.page.getByRole('treeitem', { name: /CanaryImage/ }),
        ).toBeVisible();

        await openFixture(driver, malformed);
        states['malformed'] = 'opened';
        await expect(
          pane(driver.page, 'Report Structure').getByText(
            'Invalid XML. Open Code XML to repair this report.',
          ),
        ).toBeVisible();
        await expect(
          driver.page.getByRole('treeitem', { name: /CanaryImage/ }),
        ).toHaveCount(0);
        await expect(
          driver.page.getByRole('treeitem', { name: /Field: Id/ }),
        ).toHaveCount(0);
        expect(await readText(malformed)).toBe(malformedSource);
        expect(await readText(fixture.hostile.path)).toBe(
          fixture.hostile.source,
        );

        await openFixture(driver, unsafe);
        states['unsafeDtd'] = 'opened';
        await expect(
          pane(driver.page, 'Report Structure').getByText(
            'Source-only report. Inspection and Code XML are available.',
          ),
        ).toBeVisible();
        await expect(
          driver.page.getByRole('treeitem', { name: /CanaryImage/ }),
        ).toHaveCount(0);
        expect(await readText(unsafe)).toBe(unsafeSource);
      }),
    );
    assertCleanWindow(
      failures,
      'EDGE-05 window',
      windows[0]!,
      fixture.canary.name,
    );
    record(
      failures,
      states['malformed'] === 'opened' && states['unsafeDtd'] === 'opened',
      'the malformed/unsafe source states were never reached.',
    );
  } catch (error) {
    failures.push(describeError(error));
  } finally {
    await closeOfflineSession(session, failures);
    try {
      await writeArtifact(root, 'EDGE-05-inert', {
        schemaVersion: 1,
        assertion: 'tests/desktop/offline.spec.ts::EDGE-05-inert',
        capability: capabilitySummary(capability),
        states,
        windows: windows.map(summarizeWindow),
        observationRecordsSha256: sha256(observationRecords(windows)),
        ...scopeRecord(),
        failures,
        validated: failures.length === 0,
      });
    } catch (error) {
      failures.push(`artifact: ${describeError(error)}`);
    }
  }
  if (failures.length)
    throw new Error(
      `EDGE-05 inert source states failed: ${unique(failures).join(' ')}`,
    );
});

interface LegRecord {
  readonly profile: Profile;
  /** How native history ran in this profile; the restricted one never uses the designer. */
  readonly historyRoute: HistoryRoute;
  trust: string;
  hostBlocking: Record<string, unknown> | null;
  journeys: JourneyName[];
  windows: ObservationWindow[];
  readonly failures: string[];
}

/** One disposable profile: provision, trust, block, then monitored journeys. */
async function runProfileLeg(
  profile: Profile,
  root: string,
  capability: SecurityCapability,
): Promise<LegRecord> {
  const leg: LegRecord = {
    profile,
    historyRoute: profile === 'trusted' ? 'designer' : 'source-editor',
    trust: 'unrun',
    hostBlocking: null,
    journeys: [],
    windows: [],
    failures: [],
  };
  let driver: DesktopDriver | undefined;
  let blocking: HostBlocking | undefined;
  let fixture: FixtureSet | undefined;
  try {
    // A fresh fixture per profile: whatever one profile leaves behind can never
    // contaminate the next one. It is setup only, never history proof.
    const own: FixtureSet = await createFixtureSet(root);
    fixture = own;
    driver = await launchDesktop({
      root,
      version: process.env.VSCODE_VERSION ?? '1.142.0',
      packaged: process.env.RDLC_DESKTOP_PACKAGED === 'true',
      testHarness: true,
      artifactDir: artifactRoot(root),
      workspaceDir: own.dir,
    });
    if (profile === 'trusted') {
      await grantWorkspaceTrust(driver);
      await closeTrustEditor(driver);
    }
    const trusted = await readWorkspaceTrust(driver);
    leg.trust = trusted ? 'trusted' : 'restricted';
    record(
      leg.failures,
      trusted === (profile === 'trusted'),
      `the ${profile} profile reported isTrusted=${trusted}.`,
    );
    const launchArgs =
      (driver.identity['launchArgs'] as string[] | undefined) ?? [];
    record(
      leg.failures,
      driver.identity.workspace === own.dir,
      'the window did not open the own fixture copy as its workspace.',
    );
    record(
      leg.failures,
      !launchArgs.some((arg) => /workspace-trust/i.test(arg)),
      'a launch flag forced workspace trust.',
    );
    record(
      leg.failures,
      !launchArgs.includes(root),
      'the repository root was opened as the workspace.',
    );

    // Provisioning of this profile is complete: block now.
    const blocked = await blockOutbound(driver.context);
    blocking = await enableHostBlocking();
    leg.hostBlocking = {
      mechanism: blocking.mechanism,
      ipv6: blocking.ipv6,
      ipv6Reason: blocking.ipv6Reason,
      ruleHits: blocking.hits,
      ipv6RuleHits: blocking.ipv6Hits,
      browserBlocked: blocked.blocked,
      browserHosts: blocked.hosts,
    };
    record(
      leg.failures,
      blocking.hits > 0,
      `the host blocking rule matched no probe packet (hits=${blocking.hits}).`,
    );

    const window = await observationWindow(
      driver,
      capability,
      root,
      own,
      async () => {
        // Per-profile browser positive control: one allowed, one refused.
        await webviewControls(driver!);
        leg.journeys = await runJourneys(
          {
            driver: driver!,
            hostile: own.hostile.path,
            source: own.hostile.source,
            history: leg.historyRoute,
          },
          ALL_JOURNEYS,
        );
      },
    );
    leg.windows.push(window);
    assertCleanWindow(
      leg.failures,
      `${profile} window`,
      window,
      own.canary.name,
    );
    record(
      leg.failures,
      blocked.blocked >= 1 &&
        blocked.hosts.includes('rdlc-offline-blocked.invalid'),
      `the refused non-loopback request was not counted (blocked=${blocked.blocked}).`,
    );
    record(
      leg.failures,
      (await readText(own.hostile.path)) === own.hostile.source,
      'the hostile fixture did not end byte-identical to its original source.',
    );
    record(
      leg.failures,
      leg.journeys.length === ALL_JOURNEYS.length,
      `only ${leg.journeys.length}/${ALL_JOURNEYS.length} installed supported journeys completed in the ${profile} profile (history route ${leg.historyRoute}): ${leg.journeys.join(', ') || 'none'}. An authoring refusal is never recorded as a completed journey, and an uncompleted journey stays unvalidated for this profile.`,
    );
  } catch (error) {
    leg.failures.push(describeError(error));
  } finally {
    if (blocking) {
      try {
        blocking.release();
      } catch (error) {
        leg.failures.push(`blocking release: ${describeError(error)}`);
      }
    }
    if (driver) {
      try {
        await driver.close();
      } catch (error) {
        leg.failures.push(`Desktop cleanup: ${describeError(error)}`);
      }
    }
    if (fixture) {
      try {
        await destroyFixtureSet(fixture);
      } catch (error) {
        leg.failures.push(`fixture cleanup: ${describeError(error)}`);
      }
    }
  }
  return leg;
}

test('US6.4-trusted-restricted', async () => {
  test.setTimeout(900_000);
  test.skip(hostObserverUnsupported(), hostObserverSkipReason() ?? '');
  const failures: string[] = [];
  const root = desktopRoot();
  const capability = await gatedCapability(root, 'US6.4-trusted-restricted');
  const legs: LegRecord[] = [];
  try {
    for (const profile of ['restricted', 'trusted'] as const)
      legs.push(await runProfileLeg(profile, root, capability));
    for (const leg of legs) failures.push(...leg.failures);
    record(
      failures,
      legs.length === 2 && legs.every((leg) => leg.trust === leg.profile),
      `trust states were not real: ${legs
        .map((leg) => `${leg.profile}=${leg.trust}`)
        .join(', ')}`,
    );
    record(
      failures,
      legs.length === 2 &&
        legs.every(
          (leg) =>
            leg.historyRoute ===
            (leg.profile === 'trusted' ? 'designer' : 'source-editor'),
        ),
      `history routes were not recorded per profile: ${legs
        .map((leg) => `${leg.profile}=${leg.historyRoute}`)
        .join(', ')}. Restricted designer history is never claimed accepted.`,
    );
    const serialized = JSON.stringify(
      legs.flatMap((leg) => leg.windows.map((window) => window.observation)),
    );
    record(
      failures,
      !serialized.includes('offline-secret') &&
        !serialized.includes('query=private'),
      'Sanitized observation leaked a blocked probe query or payload.',
    );
  } catch (error) {
    failures.push(describeError(error));
  } finally {
    try {
      await writeArtifact(root, 'US6.4-trusted-restricted', {
        schemaVersion: 1,
        assertion: 'tests/desktop/offline.spec.ts::US6.4-trusted-restricted',
        capability: capabilitySummary(capability),
        journeyScope: {
          profiles: Object.fromEntries(
            legs.map((leg) => [leg.profile, journeyScope(leg.journeys)]),
          ),
          statement: `US6.4 attempts every one of the ${ALL_JOURNEYS.length} installed supported journeys in both the restricted and the trusted profile; each profile records the journeys it did not complete as its own unvalidated scope, so no profile claims all-journey coverage by default and this artifact never claims T063 complete.`,
        },
        legs: legs.map((leg) => ({
          profile: leg.profile,
          trust: leg.trust,
          historyRoute: leg.historyRoute,
          historyStatement: HISTORY_ROUTE_STATEMENTS[leg.historyRoute],
          hostBlocking: leg.hostBlocking,
          journeys: { count: leg.journeys.length, names: leg.journeys },
          journeyScope: journeyScope(leg.journeys),
          windows: leg.windows.map(summarizeWindow),
          failures: leg.failures,
        })),
        observationRecordsSha256: sha256(
          JSON.stringify(
            legs.flatMap((leg) =>
              leg.windows.map((window) => window.observation),
            ),
          ),
        ),
        ...scopeRecord(),
        failures,
        validated: failures.length === 0,
      });
    } catch (error) {
      failures.push(`artifact: ${describeError(error)}`);
    }
  }
  if (failures.length)
    throw new Error(
      `US6.4 trusted/restricted offline journeys failed: ${unique(failures).join(' ')}`,
    );
});
