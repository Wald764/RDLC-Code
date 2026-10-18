import { TestBed } from '@angular/core/testing';
import { GroupsTotalsComponent } from './groups-totals.component';
import type { AuthoringState } from '@rdlc/report-model/protocol';

describe('contextual groups and totals', () => {
  it('reconciles accepted expressions and emits a scoped total only on explicit submission', () => {
    const fixture = TestBed.createComponent(GroupsTotalsComponent);
    const table: AuthoringState['tables'][number] = {
      id: '1:t',
      name: 'Sales',
      dataset: 'Orders',
      columns: 1,
      structural: true,
      reason: null,
      rows: [],
      groups: [
        { id: '1:g', name: 'ByAmount', expression: '=Fields!Amount.Value' },
      ],
    };
    fixture.componentRef.setInput('table', table);
    fixture.componentRef.setInput('fields', [
      { id: '1:f', name: 'Amount', type: 'decimal' },
    ]);
    const requests: unknown[] = [];
    fixture.componentInstance.request.subscribe((value) =>
      requests.push(value),
    );
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const form = [...root.querySelectorAll('form')].find((form) =>
      form.textContent?.includes('Add total row'),
    )!;
    const selects = form.querySelectorAll('select');
    selects[1]!.value = 'ByAmount';
    expect(requests).toEqual([]);
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(requests).toEqual([
      {
        targetId: '1:t',
        payload: {
          action: 'addTotal',
          field: 'Amount',
          scope: 'ByAmount',
          column: '0',
        },
      },
    ]);
    fixture.componentRef.setInput('table', {
      ...table,
      id: '2:t',
      groups: [
        { id: '2:g', name: 'ByRevenue', expression: '=Fields!Revenue.Value' },
      ],
    });
    fixture.detectChanges();
    expect(
      [...root.querySelectorAll('input')].some(
        (input) => input.value === '=Fields!Revenue.Value',
      ),
    ).toBe(true);
    expect(requests).toHaveLength(1);
    fixture.destroy();
  });
});
