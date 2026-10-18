import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { DesignScene, DesignSceneItem } from '@rdlc/report-model/scene';
import type { AuthoringState } from '@rdlc/report-model/protocol';
import {
  TextboxPropertiesComponent,
  type TextboxCommit,
} from '../properties/textbox-properties.component';

@Component({
  selector: 'rdlc-contextual-inspector',
  standalone: true,
  imports: [TextboxPropertiesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dataset(); as definition) {
      <h2>Dataset: {{ definition.name }}</h2>
      <p>
        Local definition only. Add or edit typed fields in Report authoring →
        Local datasets below.
      </p>
      <ul>
        @for (field of definition.fields; track field.id) {
          <li>{{ field.name }} — {{ field.type ?? 'preserved type' }}</li>
        }
      </ul>
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
          (commit)="commit.emit($event)"
        />
      } @else {
        <p>
          Whole table selected. Existing table controls are available below.
        </p>
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
  readonly item = input<DesignSceneItem | null>(null);
  readonly primary = input<DesignSceneItem | null>(null);
  readonly count = input(0);
  readonly refusal = input('');
  readonly dataset = input<AuthoringState['datasets'][number] | null>(null);
  readonly commit = output<TextboxCommit>();
}
