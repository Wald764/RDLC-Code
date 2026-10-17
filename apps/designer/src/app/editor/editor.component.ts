import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import type { EditIntent, TextboxProperty } from '@rdlc/report-model/editing';
import type { DesignScene } from '@rdlc/report-model/scene';
import { DiagnosticsComponent } from '../diagnostics/diagnostics.component';
import {
  TextboxPropertiesComponent,
  type TextboxCommit,
} from '../properties/textbox-properties.component';
import { HostAdapter } from './host-adapter';

@Component({
  selector: 'rdlc-editor',
  standalone: true,
  imports: [DiagnosticsComponent, TextboxPropertiesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss',
})
export class EditorComponent {
  readonly host = inject(HostAdapter);
  private readonly selection = signal<{
    version: number;
    index: number;
  } | null>(null);
  // Source edits can reorder items, so never carry an ordinal into another version.
  readonly selectedIndex = computed(() => {
    const selection = this.selection();
    return selection?.version === this.host.snapshot()?.version
      ? (selection?.index ?? null)
      : null;
  });
  readonly scene = computed<DesignScene | null>(
    () => this.host.snapshot()?.scene ?? null,
  );
  readonly selected = computed(() => {
    const index = this.selectedIndex();
    return index === null ? null : (this.scene()?.items[index] ?? null);
  });
  readonly status = computed(() => this.host.snapshot()?.status ?? 'waiting');
  readonly diagnostics = computed(
    () => this.host.snapshot()?.diagnostics ?? [],
  );

  select(index: number): void {
    const version = this.host.snapshot()?.version;
    if (version !== undefined) this.selection.set({ version, index });
  }

  openSource(): void {
    this.host.openSource(this.selected()?.id);
  }

  /** Typed intent only; the host validates, patches, reparses and applies. */
  commit(edit: TextboxCommit): void {
    const snapshot = this.host.snapshot();
    const item = this.selected();
    if (!snapshot || !item) return;
    const intent: EditIntent = {
      requestId: requestId(snapshot.version, edit.property),
      baseVersion: snapshot.version,
      targetId: item.id,
      operation: 'setProperty',
      payload: { property: edit.property, value: edit.value },
    };
    this.host.sendEdit(intent);
  }
}

function requestId(version: number, property: TextboxProperty): string {
  return `${version}-${property}-${Date.now().toString(36)}`;
}
