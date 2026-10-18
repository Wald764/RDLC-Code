import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { Diagnostic } from '@rdlc/report-model/diagnostics';

@Component({
  selector: 'rdlc-diagnostics',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './diagnostics.component.html',
  styleUrl: './diagnostics.component.scss',
})
export class DiagnosticsComponent {
  readonly diagnostics = input<readonly Diagnostic[]>([]);
  readonly openSource = output<string | undefined>();
}
