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
  it('renames and binds an unbound table, flagging it when several datasets exist', () => {
    const table: AuthoringState['tables'][number] = {
      id: '1:t',
      name: 'Table1',
      dataset: null,
      columns: 2,
      structural: true,
      reason: null,
      rows: [],
      groups: [],
    };
    const fixture = TestBed.createComponent(TablePropertiesComponent);
    const state = (datasets: AuthoringState['datasets']) =>
      fixture.componentRef.setInput('state', {
        id: '1:r',
        page: {},
        datasets,
        tables: [table],
      });
    state([]);
    fixture.componentRef.setInput('selectedId', '1:t');
    const requests: { payload: unknown }[] = [];
    fixture.componentInstance.request.subscribe((value) =>
      requests.push(value),
    );
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('no dataset');
    expect(root.textContent).toContain('Create a dataset');
    const name = root.querySelector<HTMLInputElement>(
      '[data-property="name"]',
    )!;
    name.value = 'Orders';
    name.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(requests.at(-1)!.payload).toEqual({
      action: 'renameTable',
      name: 'Orders',
    });
    state([
      { id: '1:d1', name: 'DataSet1', fields: [] },
      { id: '1:d2', name: 'DataSet2', fields: [] },
    ]);
    fixture.detectChanges();
    expect(root.textContent).toContain('must name one');
    const select = [...root.querySelectorAll('select')].find((s) =>
      s.closest('label')?.textContent?.includes('Dataset'),
    )!;
    expect(select.getAttribute('aria-describedby')).toBe(
      'dataset-required-1:t',
    );
    select.value = 'DataSet2';
    select.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(requests.at(-1)!.payload).toEqual({
      action: 'setTableDataset',
      dataset: 'DataSet2',
    });
    fixture.destroy();
  });
});
