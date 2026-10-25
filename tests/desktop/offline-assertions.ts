/**
 * Pure clean-window checks shared by `tests/desktop/offline.spec.ts` and this
 * module's Node unit test. The spec keeps every Desktop interaction; only the
 * assertions that must be provable without a Desktop run live here, so a unit
 * test can prove they reject an unclassified outgoing network attempt instead
 * of passing vacuously.
 */
import {
  SEMANTIC_PROOF_LIMITATION,
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

export function summarizeEvents(events: readonly SecurityEvent[]): string {
  return (
    events
      .slice(0, 5)
      .map((event) => `${event.channel}:${event.operation}:${event.target}`)
      .join(', ') || 'none'
  );
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
    `${unexpected.length} unexpected host event(s): ${summarizeEvents(unexpected)}`,
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
