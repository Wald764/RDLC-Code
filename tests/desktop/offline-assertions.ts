/**
 * Pure clean-window checks shared by `tests/desktop/offline.spec.ts` and this
 * module's Node unit test. The spec keeps every Desktop interaction; only the
 * assertions that must be provable without a Desktop run live here, so a unit
 * test can prove they reject an unclassified outgoing network attempt instead
 * of passing vacuously.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  SEMANTIC_PROOF_LIMITATION,
  sanitizeTarget,
  unexpectedEvents,
  type SecurityEvent,
  type SecurityObservation,
} from './security-observer.js';

/**
 * Outgoing network operations whose destination the shared classifier must
 * prove. An event of one of these with no classification at all fails closed
 * here, so a classification gap can never disappear from the oracle again.
 */
export const UNCLASSIFIED_NETWORK_OPERATIONS = [
  'connect',
  'sendto',
  'sendmsg',
  'sendmmsg',
] as const;

/** What `captureComplete` covers: host syscalls and webview network attempts only. */
export const CAPTURE_COMPLETE_SCOPE =
  'captureComplete covers host syscall attempts and webview network attempts only; it never proves query, entity, expression or resource evaluation.';

/** The probe loopback connect: expected host traffic, never blocking or report proof. */
export const LOOPBACK_SCOPE =
  'The probe loopback connect to 127.0.0.1 is expected host runtime traffic: host blocking deliberately allows loopback, so its refused connection proves neither host blocking nor report attribution. Only the non-loopback probe and the host blocking rule counter are blocking evidence, and no loopback event is attributed to a report journey.';

/** Requests with no frame are an explicit gap, never silently counted as background. */
export const REPORT_ATTRIBUTION_SCOPE =
  'Every http(s) request is attributed to the report surface, to the workbench, or to the explicit no-attribution gap: a request whose Playwright frame is unavailable (a service-worker request) can be neither attributed to the report nor proven not report traffic.';

export const REPORT_ZERO_SCOPE =
  'a zero report-surface count covers attributable requests only and is never absolute proof of zero report traffic.';

/** Distinct targets listed by `summarizeEvents` before the remainder is only counted. */
const SUMMARY_LIMIT = 60;
/** Pids named per attributed entry before the remainder is only counted. */
const ATTRIBUTION_PIDS = 3;
/** Longest executable path kept in an attributed summary (the tail is the informative part). */
const ATTRIBUTION_EXE_LIMIT = 80;
/** Longest attributed summary; keeps assertion messages and reports bounded. */
const ATTRIBUTED_SUMMARY_LIMIT = 6_000;

/**
 * Distinct `channel:operation:target` entries with repeat counts, so a failure
 * with many events shows every distinct kind instead of the first few repeats.
 * With `attribute`, entries are also split by the executable that made them and
 * name that executable and the pids, so a stray host event can be traced to a
 * helper process.
 */
export function summarizeEvents(
  events: readonly SecurityEvent[],
  options: { readonly attribute?: boolean } = {},
): string {
  const groups = attributeEvents(events, options.attribute === true);
  const entries = groups.map((group) => {
    const key = `${group.channel}:${group.operation}:${group.target}`;
    const counted = group.count > 1 ? `${key} (x${group.count})` : key;
    return options.attribute === true
      ? `${counted} ${attributionLabel(group)}`
      : counted;
  });
  const shown = entries.slice(0, SUMMARY_LIMIT).join(', ');
  const hidden = entries.length - SUMMARY_LIMIT;
  const text =
    (hidden > 0 ? `${shown}, and ${hidden} more distinct event(s)` : shown) ||
    'none';
  return options.attribute === true && text.length > ATTRIBUTED_SUMMARY_LIMIT
    ? `${text.slice(0, ATTRIBUTED_SUMMARY_LIMIT - 3)}...`
    : text;
}

export interface EventAttribution {
  readonly channel: SecurityEvent['channel'];
  readonly operation: string;
  readonly target: string;
  /** Sanitized executable of the calling process; null when the trace never showed it. */
  readonly exe: string | null;
  readonly pids: readonly number[];
  readonly count: number;
}

/** Distinct events (by exe too when `byExe`) with their counts and pids, in first-seen order. */
export function attributeEvents(
  events: readonly SecurityEvent[],
  byExe = true,
): EventAttribution[] {
  const groups = new Map<
    string,
    {
      channel: SecurityEvent['channel'];
      operation: string;
      target: string;
      exe: string | null;
      pids: Set<number>;
      count: number;
    }
  >();
  for (const event of events) {
    const exe = byExe ? (event.exe ?? null) : null;
    const key = `${event.channel}:${event.operation}:${event.target}\0${exe ?? ''}`;
    const group = groups.get(key) ?? {
      channel: event.channel,
      operation: event.operation,
      target: event.target,
      exe,
      pids: new Set<number>(),
      count: 0,
    };
    if (event.pid !== null) group.pids.add(event.pid);
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    pids: [...group.pids],
  }));
}

function attributionLabel(group: EventAttribution): string {
  const exe =
    group.exe === null
      ? 'unknown'
      : group.exe.length > ATTRIBUTION_EXE_LIMIT
        ? `...${group.exe.slice(-(ATTRIBUTION_EXE_LIMIT - 3))}`
        : group.exe;
  const shown = group.pids.slice(0, ATTRIBUTION_PIDS).join(',');
  const more = group.pids.length - ATTRIBUTION_PIDS;
  const pids =
    group.pids.length === 0
      ? 'unknown'
      : more > 0
        ? `${shown},+${more}`
        : shown;
  return `[exe=${exe} pid=${pids}]`;
}

export const EXTENSION_ASSET_SCOPE =
  'Requests on the VS Code local resource scheme (vscode-resource) are served from disk by the webview service worker, not the network. Only paths below the loaded extension build/designer bundle are extension assets; every other vscode-resource path (fixture directory, image, data) and every other http(s) request stays report traffic, because a report that loads a local resource would be resource evaluation.';

const VSCODE_RESOURCE_HOST =
  /^file(?:\+|%2b)[^./]*\.vscode-resource\.vscode-cdn\.net$/i;

/** Webview bundle directory the editor provider serves, relative to the extension root. */
const EXTENSION_ASSET_DIR = 'build/designer';

function posixPath(value: string): string {
  const slashed = value.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[A-Za-z]:\//.test(slashed) ? slashed.toLowerCase() : slashed;
}

/** Extension asset directories (`<extension>/build/designer`) for the loaded extension roots. */
export function extensionAssetRoots(
  extensionDirs: readonly string[],
): string[] {
  return extensionDirs.map((dir) =>
    posixPath(`${dir.replace(/\\/g, '/')}/${EXTENSION_ASSET_DIR}`),
  );
}

/**
 * Installed folders of the product extension in an `--extensions-dir`. VS Code
 * names them `<publisher>.<name>-<version>[-<target>]` with the id lowercased,
 * so the prefix match ignores case while the returned paths keep the on-disk
 * spelling. A missing or unreadable directory yields none.
 */
export function installedExtensionDirs(
  extensionsDir: string,
  publisher: string,
  name: string,
): string[] {
  const prefix = `${publisher}.${name}-`.toLowerCase();
  try {
    return readdirSync(extensionsDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && entry.name.toLowerCase().startsWith(prefix),
      )
      .map((entry) => join(extensionsDir, entry.name));
  } catch {
    return [];
  }
}

/**
 * A request target for failure messages: the origin, plus the decoded path for
 * vscode-resource URLs so a failure names the resource. Query strings and
 * fragments never appear; control characters are replaced, the path is
 * redacted like any event target and the result is capped at 200 characters.
 */
export function describeResourceTarget(
  url: string,
  origin: string,
  redactions: readonly string[] = [],
): string {
  try {
    const parsed = new URL(url);
    if (!VSCODE_RESOURCE_HOST.test(parsed.hostname)) return origin;
    const path = decodeURIComponent(parsed.pathname)
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f]/g, '_');
    return `${origin}${sanitizeTarget(path, redactions)}`.slice(0, 200);
  } catch {
    return origin;
  }
}

/**
 * The path of a vscode-resource request relative to the extension asset
 * directory it lives under, or null when it is anything else (not a
 * vscode-resource URL, outside the asset roots, or an ambiguous path). Fails
 * closed: null keeps the request counted as report traffic.
 */
export function extensionAssetPath(
  url: string,
  assetRoots: readonly string[],
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'https:' ||
    !VSCODE_RESOURCE_HOST.test(parsed.hostname)
  )
    return null;
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (path.includes('\\') || path.includes('\0')) return null;
  // A Windows drive path arrives as `/c%3A/...`; a POSIX one keeps its slash.
  const absolute = /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
  const segments = absolute.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.'))
    return null;
  const normal = posixPath(absolute);
  for (const root of assetRoots) {
    if (normal.startsWith(`${root}/`)) {
      const relative = absolute.slice(root.length + 1);
      return relative === '' ? null : `${EXTENSION_ASSET_DIR}/${relative}`;
    }
  }
  return null;
}

/** Outgoing network events carrying no classification at all: fail closed. */
export function unclassifiedNetworkEvents(
  events: readonly SecurityEvent[],
): SecurityEvent[] {
  return events.filter(
    (event) =>
      event.channel === 'network' &&
      (UNCLASSIFIED_NETWORK_OPERATIONS as readonly string[]).includes(
        event.operation,
      ) &&
      event.unexpected === undefined,
  );
}

export interface CleanWindow {
  readonly observation: SecurityObservation;
  /** Requests attributed to the report surface by a non-workbench frame. */
  readonly reportRequests: readonly string[];
}

/**
 * Zero report-triggered activity behind a non-vacuous observation. Network
 * events are deliberately not required: a genuinely quiet window records zero
 * of them, and channel coverage comes from the positive controls instead.
 */
export function cleanWindowFailures(
  label: string,
  window: CleanWindow,
  canaryName: string,
): string[] {
  const failures: string[] = [];
  const check = (condition: unknown, message: string): void => {
    if (!condition) failures.push(`${label}: ${message}`);
  };
  const { observation } = window;
  check(
    observation.native.state === 'observed',
    `host observation was ${observation.native.state}: ${observation.native.reason ?? 'no reason'}`,
  );
  check(
    observation.native.events.length > 0,
    'host observation recorded no events, so a zero result would be vacuous.',
  );
  const unclassified = unclassifiedNetworkEvents(observation.native.events);
  check(
    unclassified.length === 0,
    `${unclassified.length} unclassified outgoing network attempt(s) failed closed: ${summarizeEvents(unclassified)}`,
  );
  const unexpected = unexpectedEvents(observation.native.events);
  check(
    unexpected.length === 0,
    `${unexpected.length} unexpected host event(s): ${summarizeEvents(unexpected, { attribute: true })}`,
  );
  const canary = observation.native.events.filter((event) =>
    event.target.includes(canaryName),
  );
  check(
    canary.length === 0,
    `the canary was touched: ${summarizeEvents(canary)}`,
  );
  check(
    observation.webview.state === 'observed',
    `webview observation was ${observation.webview.state}: ${observation.webview.reason ?? 'no reason'}`,
  );
  check(
    window.reportRequests.length === 0,
    `the report surface issued ${window.reportRequests.length} attributable network request(s): ${window.reportRequests.join(', ')} (${REPORT_ZERO_SCOPE})`,
  );
  check(
    observation.captureComplete,
    `capture was incomplete (${CAPTURE_COMPLETE_SCOPE}): ${observation.failures.join(' ') || 'no failure detail recorded'}`,
  );
  check(
    observation.limitations.includes(SEMANTIC_PROOF_LIMITATION),
    'the semantic proof limitation was not recorded with the observation.',
  );
  return failures;
}
