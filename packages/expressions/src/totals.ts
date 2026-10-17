function identifier(value: string): string {
  if (
    !/^[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}\p{Cf}]*$/u.test(value)
  )
    throw new Error('Use a CLS-compatible field or scope name.');
  return value;
}

/** Unevaluated VB expression text, never a JavaScript value. */
export function fieldBinding(field: string): string {
  return `=Fields!${identifier(field)}.Value`;
}
export function sumExpression(field: string, scope: string): string {
  return `=Sum(Fields!${identifier(field)}.Value, "${identifier(scope)}")`;
}
