import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  computed,
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
  readonly pageOnly = input(false);
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
