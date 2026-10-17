import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
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
  readonly request = output<AuthoringRequest>();
  readonly types = Object.keys(fieldTypes);
}
