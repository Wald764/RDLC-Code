import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  computed,
} from '@angular/core';
import type { AuthoringRequest } from '@rdlc/report-model/editing';
import type { AuthoringState } from '@rdlc/report-model/protocol';
import { fieldTypes } from '@rdlc/report-model/report';

@Component({
  selector: 'rdlc-datasets',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './datasets.component.html',
  styleUrl: './datasets.component.scss',
})
export class DatasetsComponent {
  readonly state = input.required<AuthoringState>();
  readonly selectedId = input<string>();
  readonly datasets = computed(() =>
    this.state().datasets.filter(
      (dataset) =>
        this.selectedId() === undefined ||
        dataset.id === this.selectedId() ||
        dataset.fields.some((field) => field.id === this.selectedId()),
    ),
  );
  fields(
    dataset: AuthoringState['datasets'][number],
  ): AuthoringState['datasets'][number]['fields'] {
    return this.selectedId() === undefined || this.selectedId() === dataset.id
      ? dataset.fields
      : dataset.fields.filter((field) => field.id === this.selectedId());
  }
  readonly request = output<AuthoringRequest>();
  readonly types = Object.keys(fieldTypes);
}
