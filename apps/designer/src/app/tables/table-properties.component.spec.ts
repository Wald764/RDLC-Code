import { TestBed } from '@angular/core/testing';
import { TablePropertiesComponent } from './table-properties.component';
import type { AuthoringState } from '@rdlc/report-model/protocol';

describe('selected table authoring', () => {
  it('scopes structural/group/total controls to one table and keeps destructive confirmation', () => {
    const table: AuthoringState['tables'][number] = {
      id: '1:t',
      name: 'SalesTable',
      dataset: 'Sales',
      columns: 1,
      structural: true,
      reason: null,
      rows: [
        { cells: [{ id: '1:c', text: '=Fields!Amount.Value' }], total: false },
      ],
      groups: [],
    };
    const fixture = TestBed.createComponent(TablePropertiesComponent);
    fixture.componentRef.setInput('state', {
      id: '1:r',
      page: {},
      datasets: [],
      tables: [table, { ...table, id: '1:x', name: 'Unrelated' }],
    });
    fixture.componentRef.setInput('selectedId', '1:t');
    const requests: unknown[] = [];
    fixture.componentInstance.request.subscribe((value) =>
      requests.push(value),
    );
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).not.toContain('Unrelated');
    expect(root.querySelector('rdlc-groups-totals')).not.toBeNull();
    expect(root.querySelector('input[type=checkbox][required]')).not.toBeNull();
    expect(requests).toEqual([]);
    fixture.componentRef.setInput('selectedId', '1:c');
    fixture.detectChanges();
    expect(root.querySelector('form')).toBeNull();
    fixture.destroy();
  });
});
