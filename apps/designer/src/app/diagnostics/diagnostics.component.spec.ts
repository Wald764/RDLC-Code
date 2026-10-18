import { TestBed } from '@angular/core/testing';
import { DiagnosticsComponent } from './diagnostics.component';
import type { Diagnostic } from '@rdlc/report-model/diagnostics';

describe('actionable diagnostics', () => {
  it('announces severity, target, reason and corrective action and emits only a source target', () => {
    const fixture = TestBed.createComponent(DiagnosticsComponent);
    const diagnostic: Diagnostic = {
      code: 'VALUE',
      category: 'invalid-value',
      severity: 'error',
      range: { start: 0, end: 1 },
      itemId: '1:t',
      property: 'width',
      message: 'Width is invalid',
      correctiveAction: 'Use a positive size in Code XML.',
      blockedOperations: ['width'],
    };
    fixture.componentRef.setInput('diagnostics', [diagnostic]);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('error');
    expect(root.textContent).toContain('1:t');
    expect(root.textContent).toContain('width');
    expect(root.textContent).toContain(diagnostic.correctiveAction);
    const targets: unknown[] = [];
    fixture.componentInstance.openSource.subscribe((target) =>
      targets.push(target),
    );
    root.querySelector<HTMLButtonElement>('[data-diagnostic-source]')!.click();
    expect(targets).toEqual(['1:t']);
    expect(root.querySelector('input')).toBeNull();
    fixture.destroy();
  });
});
