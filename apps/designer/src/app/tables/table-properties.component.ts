import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  computed,
} from '@angular/core';
import type { AuthoringRequest } from '@rdlc/report-model/editing';
import type { AuthoringState } from '@rdlc/report-model/protocol';
import type { SceneBounds } from '@rdlc/report-model/scene';
import { GroupsTotalsComponent } from './groups-totals.component';

@Component({
  selector: 'rdlc-table-properties',
  standalone: true,
  imports: [GroupsTotalsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './table-properties.component.html',
  styleUrl: './table-properties.component.scss',
})
export class TablePropertiesComponent {
  readonly state = input.required<AuthoringState>();
  readonly selectedId = input<string>();
  readonly tables = computed(() =>
    this.state().tables.filter(
      (table) =>
        this.selectedId() === undefined || table.id === this.selectedId(),
    ),
  );
  readonly position = input<SceneBounds | null>(null);
  readonly request = output<AuthoringRequest>();
  fields(dataset: string | null): AuthoringState['datasets'][number]['fields'] {
    return (
      this.state().datasets.find((entry) => entry.name === dataset)?.fields ??
      []
    );
  }
}
