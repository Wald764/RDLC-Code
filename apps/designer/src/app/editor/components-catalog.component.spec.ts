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
    const chart = root.querySelector<HTMLButtonElement>('[data-card="Chart"]')!;
    expect(chart.getAttribute('aria-disabled')).toBe('true');
    expect(chart.getAttribute('aria-describedby')).toBeTruthy();
    chart.click();
    expect(emitted).toEqual([]);
    const image = root.querySelector<HTMLButtonElement>('[data-card="Image"]')!;
    expect(image.getAttribute('aria-disabled')).toBe('false');
    expect(image.getAttribute('aria-describedby')).toBeNull();
    image.click();
    expect(emitted).toEqual(['image']);
    emitted.length = 0;
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
    for (const name of ['Textbox', 'Table', 'Image', 'Dataset'])
      expect(card(name).draggable).toBe(true);
    for (const name of ['Chart', 'Parameter'])
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
    data.clear();
    const image = drag('Image');
    expect([...data]).toEqual([['application/x-rdlc-image', 'image']]);
    expect(image.prevented).toBe(false);
    data.clear();
    expect(drag('Chart').prevented).toBe(true);
    expect(data.size).toBe(0);
  });
});
