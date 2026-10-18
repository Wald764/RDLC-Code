import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  inject,
  ElementRef,
  type AfterViewInit,
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
export class AuthoringComponent implements AfterViewInit {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly state = input.required<AuthoringState>();
  readonly selected = input<DesignSceneItem | null>(null);
  readonly request = output<AuthoringRequest>();
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
  ngAfterViewInit(): void {
    // A new accepted version discards drafts and gives keyboard users a stable restart point.
    this.element.nativeElement.focus({ preventScroll: true });
  }
}
