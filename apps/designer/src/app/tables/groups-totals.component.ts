import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { AuthoringRequest } from '@rdlc/report-model/editing';
import type { AuthoringState } from '@rdlc/report-model/protocol';

@Component({
  selector: 'rdlc-groups-totals',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './groups-totals.component.html',
  styleUrl: './groups-totals.component.scss',
})
export class GroupsTotalsComponent {
  readonly table = input.required<AuthoringState['tables'][number]>();
  readonly fields =
    input.required<AuthoringState['datasets'][number]['fields']>();
  readonly request = output<AuthoringRequest>();
}
