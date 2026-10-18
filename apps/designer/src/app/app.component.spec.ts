import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { AppComponent } from './app.component';

describe('scaffold', () => {
  it('renders the design-surface host shell before a document arrives', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('rdlc-editor')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('No report connected');
  });
});
