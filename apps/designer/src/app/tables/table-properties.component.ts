import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { AuthoringRequest } from '@rdlc/report-model/editing';
import type { AuthoringState } from '@rdlc/report-model/protocol';
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
  readonly request = output<AuthoringRequest>();
  fields(dataset: string | null): AuthoringState['datasets'][number]['fields'] {
    return (
      this.state().datasets.find((entry) => entry.name === dataset)?.fields ??
      []
    );
  }
}
