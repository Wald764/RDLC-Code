import { TestBed } from '@angular/core/testing';
import { DatasetsComponent } from './datasets.component';
import type { AuthoringState } from '@rdlc/report-model/protocol';
import { fieldTypes } from '@rdlc/report-model/report';

describe('selected local definition', () => {
  for (const type of Object.keys(fieldTypes))
    it(`initializes the existing field type ${type} without an edit`, () => {
      const fixture = TestBed.createComponent(DatasetsComponent);
      fixture.componentRef.setInput('state', {
        id: '1:1',
        page: {},
        tables: [],
        datasets: [
          {
            id: '1:2',
            name: 'Orders',
            fields: [{ id: '1:3', name: 'Id', type }],
          },
        ],
      });
      fixture.componentRef.setInput('selectedId', '1:3');
      const requests: unknown[] = [];
      fixture.componentInstance.request.subscribe((request) =>
        requests.push(request),
      );
      fixture.detectChanges();
      expect(
        (fixture.nativeElement.querySelector('select') as HTMLSelectElement)
          .value,
      ).toBe(type);
      expect(requests).toEqual([]);
      fixture.destroy();
    });
  it('shows only the selected dataset/field, retains seven types and emits no initialization edits', () => {
    const fixture = TestBed.createComponent(DatasetsComponent);
    const state: AuthoringState = {
      id: '1:r',
      page: {},
      tables: [],
      datasets: [
        {
          id: '1:d',
          name: 'Sales',
          fields: [
            { id: '1:f', name: 'Amount', type: 'Decimal' },
            { id: '1:g', name: 'Date', type: 'DateTime' },
          ],
        },
        { id: '1:x', name: 'Unrelated', fields: [] },
      ],
    };
    fixture.componentRef.setInput('state', state);
    fixture.componentRef.setInput('selectedId', '1:f');
    const requests: unknown[] = [];
    fixture.componentInstance.request.subscribe((value) =>
      requests.push(value),
    );
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).not.toContain('Unrelated');
    expect(root.querySelector('[aria-label="Create dataset"]')).toBeNull();
    expect(root.querySelector('[aria-label="Create field"]')).toBeNull();
    expect(root.querySelectorAll('select option')).toHaveLength(
      Object.keys(fieldTypes).length,
    );
    expect(requests).toEqual([]);
    const form = root.querySelector('form')!;
    form.querySelector('input')!.value = 'Revenue';
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(requests).toEqual([
      { targetId: '1:f', payload: { action: 'renameField', name: 'Revenue' } },
    ]);
    expect(state.datasets[0]!.fields[0]!.name).toBe('Amount');
    fixture.destroy();
  });
});
