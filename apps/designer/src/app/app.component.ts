import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

@Component({
  selector: 'rdlc-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template:
    '<main><h1>RDLC Code</h1><p role="status">{{ status() }}</p></main>',
})
export class AppComponent {
  readonly status = signal(
    'Foundations ready. Visual editing is not available yet.',
  );
}
