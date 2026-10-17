import type { Diagnostic } from '@rdlc/report-model/diagnostics';
import type { SourceRange } from '@rdlc/report-model/document';
import type { Textbox } from '@rdlc/report-model/report';
import type { TextboxProperty } from '@rdlc/report-model/editing';
import type { XmlNode } from '@rdlc/report-model/syntax';
import { RDL_2016 } from '@rdlc/report-model/report';
import type { Reference } from '@rdlc/report-model/expressions';
import { analyze } from '@rdlc/expressions/analyze';
import { length, validateMutation, validateName } from './validate.js';

const fontWeight = new Set([
  'Default',
  'Thin',
  'ExtraLight',
  'Light',
  'Normal',
  'Medium',
  'SemiBold',
  'Bold',
  'ExtraBold',
  'Heavy',
]);
const fontStyle = new Set(['Default', 'Normal', 'Italic']);
const textAlign = new Set(['Default', 'General', 'Left', 'Center', 'Right']);
const maxFontPixels = (200 * 96) / 72;

// Known RdlColor names from MS-RDL 2.2.8; do not accept arbitrary identifiers.
const colorNames = new Set(
  `AliceBlue AntiqueWhite Aqua Aquamarine Azure Beige Bisque Black
BlanchedAlmond Blue BlueViolet Brown BurlyWood CadetBlue Chartreuse
Chocolate Coral CornflowerBlue Cornsilk Crimson Cyan DarkBlue DarkCyan
DarkGoldenrod DarkGray DarkGreen DarkKhaki DarkMagenta DarkOliveGreen
DarkOrange DarkOrchid DarkRed DarkSalmon DarkSeaGreen DarkSlateBlue
DarkSlateGray DarkTurquoise DarkViolet DeepPink DeepSkyBlue DimGray
DodgerBlue Firebrick FloralWhite ForestGreen Fuchsia Gainsboro GhostWhite
Gold Goldenrod Gray Green GreenYellow Honeydew HotPink IndianRed Indigo
Ivory Khaki Lavender LavenderBlush LawnGreen LemonChiffon LightBlue
LightCoral LightCyan LightGoldenrodYellow LightGray LightGreen LightPink
LightSalmon LightSeaGreen LightSkyBlue LightSlateGray LightSteelBlue
LightYellow Lime LimeGreen Linen Magenta Maroon MediumAquamarine MediumBlue
MediumOrchid MediumPurple MediumSeaGreen MediumSlateBlue MediumSpringGreen
MediumTurquoise MediumVioletRed MidnightBlue MintCream MistyRose Moccasin
NavajoWhite Navy OldLace Olive OliveDrab Orange OrangeRed Orchid
PaleGoldenrod PaleGreen PaleTurquoise PaleVioletRed PapayaWhip PeachPuff
Peru Pink Plum PowderBlue Purple Red RosyBrown RoyalBlue SaddleBrown
Salmon SandyBrown SeaGreen SeaShell Sienna Silver SkyBlue SlateBlue
SlateGray Snow SpringGreen SteelBlue Tan Teal Thistle Tomato Turquoise
Violet Wheat White WhiteSmoke Yellow YellowGreen ButtonFace ButtonHighlight
ButtonShadow GradientActiveCaption GradientInactiveCaption MenuBar MenuHighlight`
    .toLowerCase()
    .split(/\s+/),
);

/** Known named or hexadecimal RdlColor; no expression evaluation. */
export function validColor(value: string): boolean {
  return (
    /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value) ||
    colorNames.has(value.toLowerCase())
  );
}

/** Renames must not leave expression or visibility references pointing at the old name. */
export function validateTextboxRename(
  root: XmlNode | null,
  textbox: Textbox,
): readonly Diagnostic[] {
  const references: Reference[] = [];
  let complete = true;
  const expression = (value: string, range: SourceRange) => {
    if (!value.trimStart().startsWith('=')) return;
    const analysis = analyze(value.trimStart());
    complete &&= analysis.complete;
    references.push(
      ...analysis.references
        .filter((reference) => reference.kind === 'report-item')
        .map((reference) => ({ ...reference, range })),
    );
  };
  const visit = (node: XmlNode) => {
    expression(node.text, node.range);
    for (const attribute of node.attributes)
      expression(attribute.value, attribute.valueRange);
    if (
      node.expandedName.namespaceUri === RDL_2016 &&
      ['ToggleItem', 'RepeatWith'].includes(node.expandedName.localName)
    )
      references.push({
        kind: 'report-item',
        name: node.text,
        range: node.range,
        confidence: 'static',
      });
    for (const child of node.children) visit(child);
  };
  if (root) visit(root);
  return validateMutation({
    operation: 'rename',
    capability: textbox.capabilities.includes('name'),
    targetName: textbox.name ?? '',
    references,
    complete: complete && root !== null,
  });
}

function printable(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 255 &&
    [...value].every((character) => {
      const code = character.codePointAt(0)!;
      return code >= 0x20 && code !== 0x7f;
    })
  );
}

function diagnostic(
  code: string,
  message: string,
  range: SourceRange,
  property: TextboxProperty,
): Diagnostic {
  return {
    code,
    category: 'invalid-value',
    severity: 'error',
    range,
    message,
    correctiveAction:
      'Correct the authored value or inspect the item in source.',
    blockedOperations: ['requested-edit'],
    property,
  };
}

/**
 * Every report item name in the syntax tree, so uniqueness covers preserved and
 * nested items, not only the projected textboxes.
 */
export function reportItemNames(root: XmlNode | null): readonly string[] {
  const names: string[] = [];
  const visit = (node: XmlNode) => {
    for (const attribute of node.attributes)
      if (
        attribute.expandedName.namespaceUri === '' &&
        attribute.expandedName.localName === 'Name'
      )
        names.push(attribute.value);
    for (const child of node.children) visit(child);
  };
  if (root) visit(root);
  return names;
}

/** Validate one authored textbox property value with an actionable location. */
export function validateTextboxProperty(input: {
  readonly property: TextboxProperty;
  readonly value: string;
  readonly range: SourceRange;
  readonly existingNames: readonly string[];
}): readonly Diagnostic[] {
  const { property, value, range } = input;
  const fail = (code: string, message: string) => [
    diagnostic(code, message, range, property),
  ];
  switch (property) {
    case 'name':
      return validateName(value, input.existingNames)
        ? []
        : fail(
            'NAME_INVALID',
            'Use a unique, CLS-compatible report-item name within this report.',
          );
    case 'text':
      return [];
    case 'left':
    case 'top':
      return length(value) && length(value)!.pixels >= 0
        ? []
        : fail('POSITION_INVALID', 'Use a nonnegative RdlSize position.');
    case 'width':
    case 'height':
      return length(value) && length(value)!.pixels > 0
        ? []
        : fail('DIMENSION_INVALID', 'Use a positive RdlSize dimension.');
    case 'fontFamily':
      return printable(value)
        ? []
        : fail('FONT_FAMILY_INVALID', 'Use a nonempty local font family name.');
    case 'fontSize': {
      const size = length(value);
      return size && size.pixels >= 96 / 72 && size.pixels <= maxFontPixels
        ? []
        : fail(
            'FONT_SIZE_INVALID',
            'Use an RdlSize font size between 1pt and 200pt.',
          );
    }
    case 'fontWeight':
      return fontWeight.has(value)
        ? []
        : fail(
            'FONT_WEIGHT_INVALID',
            'Use a supported Style.FontWeight value.',
          );
    case 'fontStyle':
      return fontStyle.has(value)
        ? []
        : fail('FONT_STYLE_INVALID', 'Use Default, Normal or Italic.');
    case 'color':
      return validColor(value)
        ? []
        : fail(
            'COLOR_INVALID',
            'Use a known RDL color name, #RRGGBB or #AARRGGBB.',
          );
    case 'textAlign':
      return textAlign.has(value)
        ? []
        : fail(
            'TEXT_ALIGN_INVALID',
            'Use Default, General, Left, Center or Right.',
          );
  }
}

/** Capability guard run before planning a patch; keeps unsupported content intact. */
export function validateTextboxCapability(
  textbox: Textbox,
  property: TextboxProperty,
): readonly Diagnostic[] {
  const allowed =
    property === 'fontFamily' ||
    property === 'fontSize' ||
    property === 'fontWeight' ||
    property === 'fontStyle' ||
    property === 'color' ||
    property === 'textAlign'
      ? textbox.capabilities.includes('style')
      : textbox.capabilities.includes(property);
  if (allowed) return [];
  return [
    {
      code: 'CAPABILITY_BLOCKED',
      category: 'unsupported',
      severity: 'error',
      range: textbox.node.range,
      message: `The ${property} property is preservation-only for this textbox.`,
      correctiveAction:
        'Edit this value in the source editor; the designer will not rewrite preserved content.',
      blockedOperations: ['requested-edit'],
      itemId: textbox.node.id,
      property,
    },
  ];
}
