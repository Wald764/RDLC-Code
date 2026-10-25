import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { DesignScene, DesignSceneItem } from '@rdlc/report-model/scene';
import type { AuthoringState } from '@rdlc/report-model/protocol';
import type { AuthoringRequest } from '@rdlc/report-model/editing';
import type { InspectorSection } from './viewport';
import { DatasetsComponent } from '../datasets/datasets.component';
import { TablePropertiesComponent } from '../tables/table-properties.component';
import {
  TextboxPropertiesComponent,
  type TextboxCommit,
} from '../properties/textbox-properties.component';

/** Selected Data or Structure target; data/structural targets never carry scene bounds. */
export interface SelectedTarget {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly preservedReason: string | null;
}

@Component({
  selector: 'rdlc-contextual-inspector',
  standalone: true,
  imports: [
    TextboxPropertiesComponent,
    DatasetsComponent,
    TablePropertiesComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    h2 {
      margin: 4px 0 0;
      font-size: 13px;
    }
    h2 + p {
      margin: 0 0 8px;
      font-size: 12px;
      color: var(--rd-muted);
    }
  `,
  template: `
    @if (dataset(); as definition) {
      <h2>Dataset: {{ definition.name }}</h2>
      <p>Local declarations only; no data is fetched or evaluated.</p>
      @if (state(); as accepted) {
        <rdlc-datasets
          [state]="accepted"
          [selectedId]="structureNode()?.id ?? definition.id"
          (request)="request.emit($event)"
        />
      }
    } @else if (structureNode(); as node) {
      <h2>{{ node.label }}</h2>
      <p>
        {{ node.kind }} —
        {{
          node.preservedReason ??
            'Structural target; no independent canvas geometry. Use Code XML for unsupported properties.'
        }}
      </p>
    } @else if (count() > 1) {
      <h2>{{ count() }} selected</h2>
      <p>
        Primary: {{ primary()?.label }}. Use arrangement commands; scalar
        properties require one item.
      </p>
    } @else if (item(); as selected) {
      <h2>{{ selected.name ?? selected.label }}</h2>
      <p>{{ selected.kind ?? 'textbox' }}</p>
      @if (selected.placeholder) {
        <p>
          Preserved content. Use Code XML to inspect unsupported properties.
        </p>
      } @else if (selected.kind !== 'table') {
        <rdlc-textbox-properties
          [item]="selected"
          [refusal]="refusal()"
          [expanded]="expanded()"
          (expand)="expand.emit($event)"
          (commit)="commit.emit($event)"
        />
      } @else {
        @if (state(); as accepted) {
          <rdlc-table-properties
            [state]="accepted"
            [selectedId]="selected.id"
            [position]="selected.geometry ?? null"
            (request)="request.emit($event)"
          />
        }
      }
      @if (
        !selected.placeholder &&
        selected.kind !== 'cell' &&
        selected.kind !== 'table' &&
        selected.capabilities?.includes('textbox')
      ) {
        <form
          aria-label="Delete textbox"
          (submit)="
            $event.preventDefault();
            request.emit({
              targetId: selected.id,
              payload: {
                action: 'deleteTextbox',
                confirm: confirmation.checked ? 'delete-contained-content' : '',
              },
            })
          "
        >
          <label
            ><input #confirmation type="checkbox" required />Delete
            {{ selected.name ?? selected.label }} including all contained
            unsupported XML</label
          >
          <button type="submit">Delete textbox</button>
        </form>
      }
    } @else {
      <h2>Report</h2>
      <p>Select an item to inspect its supported properties.</p>
      @if (scene(); as report) {
        <p>
          Page: {{ report.page.width }} × {{ report.page.height }} CSS px. Body:
          {{ report.body.width }} × {{ report.body.height }} CSS px. Authored
          design only.
        </p>
      }
    }
  `,
})
export class ContextualInspectorComponent {
  readonly scene = input<DesignScene | null>(null);
  readonly state = input<AuthoringState | null>(null);
  readonly item = input<DesignSceneItem | null>(null);
  readonly primary = input<DesignSceneItem | null>(null);
  readonly count = input(0);
  readonly refusal = input('');
  readonly dataset = input<AuthoringState['datasets'][number] | null>(null);
  readonly structureNode = input<SelectedTarget | null>(null);
  readonly expanded = input<Partial<Record<InspectorSection, boolean>>>({});
  readonly commit = output<TextboxCommit>();
  readonly expand = output<{ section: InspectorSection; open: boolean }>();
  readonly request = output<AuthoringRequest>();
}
