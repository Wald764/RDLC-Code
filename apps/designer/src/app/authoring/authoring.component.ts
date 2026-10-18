import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  computed,
  signal,
  effect,
} from '@angular/core';
import type { AuthoringRequest } from '@rdlc/report-model/editing';
import type { AuthoringState } from '@rdlc/report-model/protocol';
import type { DesignSceneItem } from '@rdlc/report-model/scene';
import { DatasetsComponent } from '../datasets/datasets.component';
import { TablePropertiesComponent } from '../tables/table-properties.component';

@Component({
  selector: 'rdlc-authoring',
  standalone: true,
  imports: [DatasetsComponent, TablePropertiesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './authoring.component.html',
  styleUrl: './authoring.component.scss',
  host: { tabindex: '-1' },
})
export class AuthoringComponent {
  readonly state = input.required<AuthoringState>();
  readonly selected = input<DesignSceneItem | null>(null);
  readonly request = output<AuthoringRequest>();
  readonly creation = input<'textbox' | 'dataset' | 'table' | null>(null);
  readonly compact = input(false);
  readonly pageOnly = input(false);
  readonly pending = input(false);
  readonly cancel = output<void>();
  readonly prerequisite = output<void>();
  readonly submitted = signal(false);
  readonly datasetName = signal('');
  readonly dataset = computed(
    () =>
      this.state().datasets.find((d) => d.name === this.datasetName()) ??
      this.state().datasets[0],
  );
  constructor() {
    effect(() => {
      if (!this.pending()) this.submitted.set(false);
    });
  }
  submitCreation(
    form: HTMLFormElement,
    name: string,
    field = '',
    width = '',
  ): void {
    if (this.pending() || this.submitted() || !form.reportValidity()) return;
    const kind = this.creation();
    if (!kind) return;
    const payload: AuthoringRequest['payload'] =
      kind === 'textbox'
        ? { action: 'createTextbox', name }
        : kind === 'dataset'
          ? { action: 'createDataset', name }
          : {
              action: 'createTable',
              name,
              dataset: this.dataset()?.name ?? '',
              field,
              width,
            };
    this.submitted.set(true);
    this.request.emit({ targetId: this.state().id, payload });
  }
  readonly pageProperties = [
    'width',
    'height',
    'top',
    'right',
    'bottom',
    'left',
    'bodyWidth',
    'bodyHeight',
  ];
  /** Only a supported body textbox offers textbox deletion; cells, tables and placeholders never do. */
  readonly deletable = computed(() => {
    const item = this.selected();
    return item && !item.placeholder && (item.kind ?? 'textbox') === 'textbox'
      ? item
      : null;
  });
}
