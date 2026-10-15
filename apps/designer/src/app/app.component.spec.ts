import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { AppComponent } from './app.component';

describe('scaffold', () => {
  it('renders accepted local signal state with a status label', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelector('[role="status"]').textContent,
    ).toContain('Foundations ready');
    fixture.componentInstance.status.set('Source only');
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Source only');
  });
});
