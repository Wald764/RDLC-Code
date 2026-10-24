import type { NavigationNode } from '@rdlc/report-model/navigation';
import type { DesignScene } from '@rdlc/report-model/scene';
import type { ClipboardAction } from '@rdlc/report-model/clipboard';
import type { NativeIntent } from './host-context.js';

/** Eligibility is checked again by the captured host/session and existing clipboard engine. */
export function clipboardIntent(
  node: NavigationNode,
  scene: DesignScene | null,
  action: ClipboardAction,
): NativeIntent {
  if (
    !node.capabilities.some(
      (capability) =>
        capability.operation === 'clipboard' && capability.eligible,
    ) ||
    !scene?.items.some((item) => item.id === node.id && item.kind !== 'cell')
  )
    throw new Error(
      'Clipboard actions require an eligible report body item. Inspect Code XML for this target.',
    );
  return { action: 'clipboard', clipboard: action };
}
