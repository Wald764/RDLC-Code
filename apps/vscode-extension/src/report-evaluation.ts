import type { DocumentSnapshot } from '@rdlc/report-model/document';
import type { ReportProjection } from '@rdlc/report-model/report';
import type { XmlNode, XmlSyntaxDocument } from '@rdlc/report-model/syntax';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { projectNavigation } from '@rdlc/renderer/navigation';
import type { AcceptedNavigation } from '@rdlc/report-model/navigation';
import { renderScene } from '@rdlc/renderer/render';
import type { DesignScene } from '@rdlc/report-model/scene';

/** The part of a VS Code TextDocument this host-neutral evaluator needs. */
export interface ReportDocument {
  readonly uri: { toString(): string };
  readonly version: number;
  readonly eol: number;
  getText(): string;
}

/** vscode.EndOfLine.CRLF; literal because this module is tested outside VS Code. */
const CRLF = 2;

/** Parser/profile/capability facts for one accepted document version. */
export interface ReportEvaluation {
  readonly snapshot: DocumentSnapshot;
  readonly syntax: XmlSyntaxDocument;
  readonly projection: ReportProjection;
  /** Authored targets eligible for navigation, in legacy evaluation order. */
  readonly ids: readonly string[];
  /** Every parsed node ID, including preservation-only content. */
  readonly sourceIds: readonly string[];
  readonly capabilities: readonly string[];
  readonly navigation: AcceptedNavigation;
  readonly scene: DesignScene | null;
}

export function snapshotOf(document: ReportDocument): DocumentSnapshot {
  return {
    uri: document.uri.toString(),
    version: document.version,
    source: document.getText(),
    eol: document.eol === CRLF ? '\r\n' : '\n',
  };
}

/** Source-order syntax nodes; the shared identity list for source navigation. */
export function syntaxNodes(node: XmlNode | null): XmlNode[] {
  return node ? [node, ...node.children.flatMap(syntaxNodes)] : [];
}

/** Evaluate accepted text without a designer, webview or mutable report copy. */
export function evaluateReport(snapshot: DocumentSnapshot): ReportEvaluation {
  const syntax = parse(snapshot);
  const projection = projectReport(syntax);
  const scene = renderScene(projection);
  const bodyIds = new Set(
    (scene?.items ?? [])
      .filter((item) => item.kind !== 'cell')
      .map((item) => item.id),
  );
  const navigation = projectNavigation(syntax, projection);
  return {
    snapshot,
    syntax,
    projection,
    navigation: {
      ...navigation,
      structure: {
        ...navigation.structure,
        nodes: navigation.structure.nodes.map((node) => ({
          ...node,
          capabilities: [
            ...node.capabilities,
            {
              operation: 'clipboard',
              eligible:
                projection.status === 'editable' && bodyIds.has(node.id),
              reason:
                projection.status === 'editable' && bodyIds.has(node.id)
                  ? null
                  : 'Clipboard requires an editable report body item.',
            },
          ],
        })),
      },
    },
    scene,
    ids: [
      ...(syntax.root ? [syntax.root.id] : []),
      ...projection.textboxes.map((textbox) => textbox.node.id),
      ...projection.datasets.flatMap((dataset) => [
        dataset.node.id,
        ...dataset.fields.map((field) => field.node.id),
      ]),
      ...projection.tables.flatMap((table) => [
        table.node.id,
        ...table.groups.map((group) => group.node.id),
      ]),
    ],
    sourceIds: syntaxNodes(syntax.root).map((node) => node.id),
    capabilities:
      projection.status === 'editable'
        ? ['setProperty', 'author', 'layout', 'clipboard']
        : [],
  };
}
