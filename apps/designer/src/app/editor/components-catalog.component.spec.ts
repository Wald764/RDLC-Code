import { TestBed } from '@angular/core/testing';
import { ComponentsCatalogComponent } from './components-catalog.component';

describe('component catalog', () => {
  it('has eleven unique honest cards with category-preserving case-insensitive search and recovery', () => {
    const fixture = TestBed.createComponent(ComponentsCatalogComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('[data-card]').length).toBe(11);
    expect(
      new Set(
        [...root.querySelectorAll('[data-card]')].map((n) => n.textContent),
      ).size,
    ).toBe(11);
    const emitted: string[] = [];
    fixture.componentInstance.create.subscribe((v) => emitted.push(v));
    const image = root.querySelector<HTMLButtonElement>('[data-card="Image"]')!;
    expect(image.getAttribute('aria-disabled')).toBe('true');
    expect(image.getAttribute('aria-describedby')).toBeTruthy();
    image.click();
    expect(emitted).toEqual([]);
    fixture.componentInstance.query.set('tExTbOx');
    fixture.detectChanges();
    expect(root.querySelectorAll('[data-card]').length).toBe(1);
    expect(root.textContent).toContain('Report items');
    root.querySelector<HTMLButtonElement>('[data-card="Textbox"]')!.click();
    expect(emitted).toEqual(['textbox']);
    fixture.componentInstance.query.set('no match');
    fixture.detectChanges();
    expect(root.textContent).toContain('No components');
    root.querySelector<HTMLButtonElement>('[data-clear]')!.click();
    fixture.detectChanges();
    expect(root.querySelectorAll('[data-card]').length).toBe(11);
  });
  it('drags only available cards and carries just the component kind', () => {
    const fixture = TestBed.createComponent(ComponentsCatalogComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const card = (name: string) =>
      root.querySelector<HTMLButtonElement>(`[data-card="${name}"]`)!;
    for (const name of ['Textbox', 'Table', 'Dataset'])
      expect(card(name).draggable).toBe(true);
    for (const name of ['Image', 'Chart', 'Parameter'])
      expect(card(name).draggable).toBe(false);
    const data = new Map<string, string>();
    const drag = (name: string) => {
      let prevented = false;
      const event = {
        dataTransfer: {
          setData: (type: string, value: string) => data.set(type, value),
          effectAllowed: 'all',
        },
        preventDefault: () => (prevented = true),
      };
      fixture.componentInstance.dragStart(event as unknown as DragEvent, name);
      return { event, prevented };
    };
    const textbox = drag('Textbox');
    expect([...data]).toEqual([['application/x-rdlc-textbox', 'textbox']]);
    expect(textbox.event.dataTransfer.effectAllowed).toBe('copy');
    expect(drag('Image').prevented).toBe(true);
    expect(data.size).toBe(1);
  });
});
