import { TestBed } from '@angular/core/testing';
import type { DesignSceneItem } from '@rdlc/report-model/scene';
import {
  TextboxPropertiesComponent,
  type TextboxCommit,
} from './textbox-properties.component';

const item = (text: string): DesignSceneItem =>
  ({
    id: '2:3',
    bounds: { left: 0, top: 0, width: 96, height: 24 },
    label: 'Textbox: Front',
    placeholder: false,
    name: 'Front',
    text,
    geometry: { left: '0in', top: '0in', width: '1in', height: '0.25in' },
    style: null,
    capabilities: ['textbox', 'name', 'text'],
  }) as DesignSceneItem;

describe('textbox properties', () => {
  it('drops typed text superseded by a newer accepted item so its blur commits nothing', () => {
    const fixture = TestBed.createComponent(TextboxPropertiesComponent);
    fixture.componentRef.setInput('item', item('Alpha report'));
    fixture.detectChanges();
    const commits: TextboxCommit[] = [];
    fixture.componentInstance.commit.subscribe((commit) =>
      commits.push(commit),
    );
    const root = fixture.nativeElement as HTMLElement;
    const name = root.querySelector<HTMLInputElement>(
      'input[data-property="name"]',
    )!;
    name.value = 'DraftBeforeReload';
    name.dispatchEvent(new Event('input'));

    // An external reload publishes a new accepted item with the same name.
    fixture.componentRef.setInput('item', item('Reloaded front'));
    fixture.detectChanges();
    const same = root.querySelector<HTMLInputElement>(
      'input[data-property="name"]',
    )!;
    expect(same).toBe(name);
    expect(same.value).toBe('Front');
    same.dispatchEvent(new Event('change'));
    expect(commits).toEqual([]);
  });

  it('keeps typed text while the accepted item is unchanged, even re-emitted', () => {
    const fixture = TestBed.createComponent(TextboxPropertiesComponent);
    const accepted = item('Alpha report');
    fixture.componentRef.setInput('item', accepted);
    fixture.detectChanges();
    const name = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLInputElement>('input[data-property="name"]')!;
    name.value = 'Typing';
    fixture.detectChanges();
    expect(name.value).toBe('Typing');
    // The editor re-emits an equal item as a new object while the user types.
    fixture.componentRef.setInput('item', { ...accepted });
    fixture.detectChanges();
    expect(name.value).toBe('Typing');
  });
});
