import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { StructureTreeComponent } from './structure-tree.component';
import type { StructureNode } from '@rdlc/report-model/protocol';

const node = (
  id: string,
  kind: StructureNode['kind'],
  name: string | null,
  parentId: string | null,
  preservedReason: string | null = null,
): StructureNode => ({
  id,
  parentId,
  kind,
  name,
  label: name ?? kind,
  range: { start: 0, end: 0 },
  preservedReason,
});

const nodes: StructureNode[] = [
  node('1:r', 'report', null, null),
  node('1:t', 'textbox', 'Title', '1:r'),
  node('1:p', 'preserved', null, '1:r', 'Chart is opaque'),
];

const nested: StructureNode[] = [
  node('1:r', 'report', null, null),
  node('1:t', 'textbox', 'Title', '1:r'),
  node('1:tb', 'table', 'Orders', '1:r'),
  node('1:c', 'cell', null, '1:tb'),
  node('1:p', 'preserved', null, '1:r', 'Chart is opaque'),
];

describe('Structure keyboard navigation', () => {
  it('uses one roving stop, expands ancestors, navigates and selects without mutation', () => {
    const fixture = TestBed.createComponent(StructureTreeComponent);
    fixture.componentRef.setInput('structure', { nodes, truncated: true });
    fixture.componentRef.setInput('selectedIds', ['1:t']);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const rows = () => [
      ...root.querySelectorAll<HTMLElement>('[role=treeitem]'),
    ];
    expect(rows()).toHaveLength(3);
    expect(rows().filter((row) => row.tabIndex === 0)).toHaveLength(1);
    const selected: unknown[] = [];
    fixture.componentInstance.select.subscribe((value) => selected.push(value));
    rows()[0]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    );
    fixture.detectChanges();
    rows()[2]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    expect(selected).toEqual([{ id: '1:p', additive: false }]);
    expect(root.textContent).toContain('Chart is opaque');
    expect(root.textContent).toContain('incomplete');
    fixture.componentRef.setInput('selectedIds', ['omitted']);
    fixture.detectChanges();
    expect(root.textContent).toContain('not included');
    fixture.destroy();
  });

  it('walks rows with arrows/Home/End, expands and collapses, and keeps typing native', () => {
    const fixture = TestBed.createComponent(StructureTreeComponent);
    fixture.componentRef.setInput('structure', {
      nodes: nested,
      truncated: false,
    });
    fixture.componentRef.setInput('selectedIds', ['1:t']);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const rows = () => [
      ...root.querySelectorAll<HTMLElement>('[role=treeitem]'),
    ];
    const press = (
      row: HTMLElement,
      key: string,
      mods: KeyboardEventInit = {},
    ) => {
      row.focus();
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...mods,
      });
      row.dispatchEvent(event);
      fixture.detectChanges();
      return event;
    };
    const selected: unknown[] = [];
    fixture.componentInstance.select.subscribe((value) => selected.push(value));
    press(rows()[0]!, 'ArrowDown');
    expect(
      (document.activeElement as HTMLElement | null)?.dataset['node'],
    ).toBe('1:t');
    expect(rows().filter((row) => row.tabIndex === 0)).toHaveLength(1);
    press(rows()[1]!, 'End');
    expect(
      (document.activeElement as HTMLElement | null)?.dataset['node'],
    ).toBe('1:p');
    press(rows()[3]!, 'Home');
    expect(
      (document.activeElement as HTMLElement | null)?.dataset['node'],
    ).toBe('1:r');
    press(rows()[0]!, 'ArrowRight');
    expect(
      (document.activeElement as HTMLElement | null)?.dataset['node'],
    ).toBe('1:t');
    press(rows()[2]!, 'ArrowRight');
    expect(
      (document.activeElement as HTMLElement | null)?.dataset['node'],
    ).toBe('1:tb');
    expect(rows()).toHaveLength(5);
    press(rows()[2]!, 'ArrowLeft');
    expect(rows()).toHaveLength(4);
    expect(
      (document.activeElement as HTMLElement | null)?.dataset['node'],
    ).toBe('1:tb');
    press(rows()[2]!, 'ArrowLeft');
    expect(
      (document.activeElement as HTMLElement | null)?.dataset['node'],
    ).toBe('1:r');
    const typing = press(rows()[1]!, 'a');
    expect(typing.defaultPrevented).toBe(false);
    press(rows()[1]!, ' ', { shiftKey: true });
    press(rows()[1]!, 'Enter', { ctrlKey: true });
    expect(selected).toEqual([
      { id: '1:t', additive: true },
      { id: '1:t', additive: true },
    ]);
    fixture.destroy();
  });

  it('labels eligible, preserved, incomplete and stale targets and offers source', () => {
    const fixture = TestBed.createComponent(StructureTreeComponent);
    fixture.componentRef.setInput('structure', { nodes, truncated: true });
    fixture.componentRef.setInput('selectedIds', ['1:t']);
    fixture.componentRef.setInput('editableIds', ['1:t']);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Supported editing available');
    expect(root.textContent).toContain('Preservation-only');
    expect(root.textContent).toContain('Chart is opaque — use Code XML.');
    expect(root.textContent).toContain('Structure is incomplete');
    expect(root.textContent).not.toContain(
      'The selected target is not included',
    );
    fixture.componentRef.setInput('selectedIds', ['omitted']);
    fixture.detectChanges();
    expect(root.textContent).toContain('The selected target is not included');
    const sourced: number[] = [];
    fixture.componentInstance.source.subscribe(() => sourced.push(1));
    [...root.querySelectorAll('button')].at(-1)!.click();
    expect(sourced).toHaveLength(1);
    fixture.componentRef.setInput('structure', null);
    fixture.detectChanges();
    expect(root.textContent).toContain('Structure is unavailable');
    fixture.destroy();
  });

  it('retains unrelated expansion and maps focus to surviving named ancestry across versions', async () => {
    const fixture = TestBed.createComponent(StructureTreeComponent);
    fixture.componentRef.setInput('structure', {
      nodes: nested,
      truncated: false,
    });
    fixture.componentRef.setInput('selectedIds', ['1:t']);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const rows = () => [
      ...root.querySelectorAll<HTMLElement>('[role=treeitem]'),
    ];
    root
      .querySelectorAll<HTMLButtonElement>('[role=treeitem] button')[1]!
      .click();
    fixture.detectChanges();
    expect(rows()).toHaveLength(5);
    fixture.componentRef.setInput('structure', {
      nodes: [...nested],
      truncated: false,
    });
    fixture.detectChanges();
    expect(rows()).toHaveLength(5);
    rows()[3]!.focus();
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const v2: StructureNode[] = [
      node('2:r', 'report', null, null),
      node('2:t', 'textbox', 'Title', '2:r'),
      node('2:tb', 'table', 'Orders', '2:r'),
      node('2:c', 'cell', null, '2:tb'),
    ];
    fixture.componentRef.setInput('structure', { nodes: v2, truncated: false });
    fixture.componentRef.setInput('selectedIds', ['2:t']);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(focus).toHaveBeenCalled();
    expect(
      (document.activeElement as HTMLElement | null)?.dataset['node'],
    ).toBe('2:tb');
    expect(rows()).toHaveLength(4);
    rows()[3]!.focus();
    focus.mockClear();
    fixture.componentRef.setInput('structure', {
      nodes: [
        node('3:r', 'report', null, null),
        node('3:t', 'textbox', 'Title', '3:r'),
      ],
      truncated: false,
    });
    fixture.componentRef.setInput('selectedIds', ['3:t']);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(
      (document.activeElement as HTMLElement | null)?.dataset['node'],
    ).toBe('3:r');
    focus.mockRestore();
    fixture.destroy();
  });
});
