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
});
