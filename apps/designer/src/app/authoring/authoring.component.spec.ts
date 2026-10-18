import { TestBed } from '@angular/core/testing';
import { AuthoringComponent } from './authoring.component';
import type { AuthoringRequest } from '@rdlc/report-model/editing';
import { validateMessage } from '@rdlc/report-model/protocol';

describe('authoring forms', () => {
  it('offers labeled keyboard forms and emits typed actions without changing accepted state', async () => {
    await TestBed.configureTestingModule({
      imports: [AuthoringComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(AuthoringComponent);
    fixture.componentRef.setInput('state', {
      id: 'root-1',
      page: { width: '8.5in', bodyHeight: '2in' },
      datasets: [],
      tables: [],
    });
    fixture.componentRef.setInput('selected', null);
    fixture.detectChanges();
    const requests: unknown[] = [];
    fixture.componentInstance.request.subscribe((value) =>
      requests.push(value),
    );
    const form: HTMLFormElement = fixture.nativeElement.querySelector(
      '[aria-label="Create textbox"]',
    );
    const input = form.querySelector('input')!;
    input.value = 'Heading';
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(requests).toEqual([
      {
        targetId: 'root-1',
        payload: { action: 'createTextbox', name: 'Heading' },
      },
    ]);
    expect(fixture.componentInstance.state().datasets.length).toBe(0);
    expect(
      fixture.nativeElement.querySelectorAll('label').length,
    ).toBeGreaterThan(2);
  });
  it('exposes every authoring action through labeled native controls without pointer gestures', async () => {
    const fixture = TestBed.createComponent(AuthoringComponent);
    fixture.componentRef.setInput('state', {
      id: 'root-1',
      page: {
        width: '8.5in',
        height: '11in',
        left: '1in',
        right: '1in',
        top: '1in',
        bottom: '1in',
        bodyWidth: '6.5in',
        bodyHeight: '2in',
      },
      datasets: [
        {
          id: 'dataset-1',
          name: 'Orders',
          fields: [
            { id: 'field-1', name: 'Amount', type: 'decimal' },
            { id: 'field-2', name: 'Opaque', type: null },
          ],
        },
      ],
      tables: [
        {
          id: 'table-1',
          name: 'Table1',
          dataset: 'Orders',
          structural: true,
          reason: null,
          columns: 2,
          rows: [{ cells: [], total: true }],
          groups: [
            {
              id: 'group-1',
              name: 'ByAmount',
              expression: '=Fields!Amount.Value',
            },
          ],
        },
      ],
    });
    fixture.componentRef.setInput('selected', {
      id: 'box-1',
      name: 'Title',
      bounds: { left: 0, top: 0, width: 1, height: 1 },
      label: 'Title',
      placeholder: false,
    });
    fixture.detectChanges();
    const requests: AuthoringRequest[] = [];
    fixture.componentInstance.request.subscribe((request) =>
      requests.push(request),
    );
    const element = fixture.nativeElement as HTMLElement;
    for (const control of element.querySelectorAll('input, select'))
      expect(control.closest('label')).not.toBeNull();
    expect(element.querySelector('[tabindex="1"]')).toBeNull();
    for (const input of element.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    ))
      input.checked = true;
    for (const form of element.querySelectorAll('form')) {
      if (!form.closest('fieldset[disabled]'))
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    }
    for (const button of element.querySelectorAll<HTMLButtonElement>(
      'button[type="button"]',
    )) {
      if (!button.closest('fieldset[disabled]')) button.click();
    }
    const actions = new Set(requests.map((request) => request.payload.action));
    for (const action of [
      'createTextbox',
      'deleteTextbox',
      'setPage',
      'createDataset',
      'renameDataset',
      'deleteDataset',
      'createField',
      'renameField',
      'deleteField',
      'setFieldType',
      'createTable',
      'setTableProperty',
      'setColumnWidth',
      'setRowHeight',
      'deleteTable',
      'addColumn',
      'removeColumn',
      'addGroup',
      'changeGroup',
      'removeGroup',
      'addTotal',
      'changeTotal',
      'removeTotal',
    ] as const)
      expect(actions.has(action)).toBe(true);
    for (const [index, request] of requests.entries())
      expect(
        validateMessage({
          protocol: 1,
          kind: 'edit',
          requestId: `form-${index}`,
          baseVersion: 1,
          operation: 'author',
          ...request,
        }),
      ).not.toBeNull();
    expect(element.querySelectorAll('fieldset[disabled]').length).toBe(1);
  });

  for (const kind of ['cell', 'table', 'preserved'] as const)
    it(`grants no textbox deletion to a selected ${kind}`, () => {
      const fixture = TestBed.createComponent(AuthoringComponent);
      fixture.componentRef.setInput('state', {
        id: 'root-1',
        page: {},
        datasets: [],
        tables: [],
      });
      fixture.componentRef.setInput('selected', {
        id: 'x-1',
        kind,
        name: 'X',
        bounds: null,
        label: 'X',
        placeholder: kind === 'preserved',
      });
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('[aria-label="Delete textbox"]'),
      ).toBeNull();
    });
});
