import { ChangeDetectionStrategy, Component } from '@angular/core';
import { EditorComponent } from './editor/editor.component';

@Component({
  selector: 'rdlc-root',
  standalone: true,
  imports: [EditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<rdlc-editor />',
})
export class AppComponent {}
