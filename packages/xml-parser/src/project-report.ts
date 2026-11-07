import type { XmlNode, XmlSyntaxDocument } from '@rdlc/report-model/syntax';
import type {
  EmbeddedImageDefinition,
  ImageItem,
  PreservedRegion,
  ReportProjection,
  ReportSection,
} from '@rdlc/report-model/report';
import type { Diagnostic } from '@rdlc/report-model/diagnostics';
import { children, RDL_2016 } from './names.js';
import { projectTextboxes } from './project-textboxes.js';
import { projectDatasets } from './project-datasets.js';
import { projectTables } from './project-tables.js';
import { projectImages } from './project-images.js';

export { children, RDL_2016 } from './names.js';

export interface ProjectReportOptions {
  /** Host-supplied SHA-256 of decoded image bytes; image hashes are `null` without it. */
  readonly digest?: (bytes: Uint8Array) => string;
}

export function projectReport(
  document: XmlSyntaxDocument,
  options: ProjectReportOptions = {},
): ReportProjection {
  const root = document.root;
  const diagnostics: Diagnostic[] = [...document.diagnostics];
  const preserved: PreservedRegion[] = [];
  let section: ReportSection | null = null;
  let images: readonly ImageItem[] = [];
  let embeddedImages: readonly EmbeddedImageDefinition[] = [];
  let editable =
    document.status === 'valid' &&
    root?.expandedName.namespaceUri === RDL_2016 &&
    root.expandedName.localName === 'Report';
  if (root) {
    const containers = children(root, 'ReportSections');
    const sections = containers.flatMap((node) =>
      children(node, 'ReportSection'),
    );
    editable &&= containers.length === 1 && sections.length === 1;
    const mustUnderstand = root.attributes.find(
      (a) =>
        a.expandedName.namespaceUri === '' &&
        a.expandedName.localName === 'MustUnderstand',
    );
    if (
      mustUnderstand?.value
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .some((prefix) => root.namespaces[prefix] !== RDL_2016)
    )
      editable = false;
    if (editable && sections[0]) {
      const node = sections[0];
      const bodies = children(node, 'Body');
      const widths = children(node, 'Width');
      const pages = children(node, 'Page');
      if (
        bodies.length !== 1 ||
        widths.length !== 1 ||
        pages.length !== 1 ||
        children(bodies[0]!, 'Height').length !== 1
      )
        editable = false;
      else {
        const page = pages[0]!;
        const scalar = (name: string, fallback: string) =>
          children(page, name)[0]?.text ?? fallback;
        section = {
          node,
          width: widths[0]!.text,
          height: children(bodies[0]!, 'Height')[0]!.text,
          page: {
            width: scalar('PageWidth', '8.5in'),
            height: scalar('PageHeight', '11in'),
            top: scalar('TopMargin', '0in'),
            right: scalar('RightMargin', '0in'),
            bottom: scalar('BottomMargin', '0in'),
            left: scalar('LeftMargin', '0in'),
          },
        };
      }
    }
    const structural = new Set([
      'Report',
      'ReportSections',
      'ReportSection',
      'Body',
      'Height',
      'Width',
      'Page',
      'PageWidth',
      'PageHeight',
      'TopMargin',
      'RightMargin',
      'BottomMargin',
      'LeftMargin',
    ]);
    // Authorable body images (editable or geometry-only) are no longer opaque regions.
    const authorable = new Set<XmlNode>();
    ({ images, embeddedImages } = projectImages(root, {
      ...options,
      editable,
    }));
    for (const image of images)
      if (image.capabilities.length > 0) authorable.add(image.node);
    const visit = (node: XmlNode) => {
      if (authorable.has(node)) return;
      if (
        node.expandedName.namespaceUri !== RDL_2016 ||
        !structural.has(node.expandedName.localName)
      )
        preserved.push({
          nodeId: node.id,
          range: node.range,
          namespaces: node.namespaces,
          reason:
            'Outside the foundation projection; retain exact source in place.',
        });
      for (const child of node.children) visit(child);
    };
    visit(root);
  }
  if (!editable && document.status === 'valid')
    diagnostics.push({
      code: 'REPORT_SOURCE_ONLY',
      category: 'unsupported',
      severity: 'warning',
      range: root?.range ?? { start: 0, end: 0 },
      message:
        'Visual authoring requires RDL 2016/01, exactly one complete section and understood MustUnderstand namespaces.',
      correctiveAction: 'Use the source editor; no conversion is performed.',
      blockedOperations: ['visual-edit'],
      citation:
        'vendor/02-structures/2.6-reportsection.md; vendor/02-structures/2.3.1-report.mustunderstand.md',
    });
  const textboxes = projectTextboxes(section);
  const datasets = projectDatasets(root);
  const tables = projectTables(section, textboxes);
  // MS-RDL 2.23.10: a top-level table must name its dataset once there are several.
  if (datasets.length > 1)
    for (const table of tables)
      if (table.dataset === null)
        diagnostics.push({
          code: 'TABLE_DATASET_REQUIRED',
          category: 'invalid-value',
          severity: 'warning',
          range: table.node.range,
          message: `Table ${table.name} has no dataset, and this report declares several.`,
          correctiveAction: 'Choose a dataset in the table properties.',
          blockedOperations: [],
          citation: 'vendor/02-structures/2.23.10-tablix.datasetname.md',
        });
  return {
    version: document.snapshot.version,
    namespace: root?.expandedName.namespaceUri ?? null,
    status:
      document.status === 'invalid-source'
        ? 'invalid-source'
        : editable
          ? 'editable'
          : 'source-only',
    capabilities: editable ? ['source', 'projection'] : ['source'],
    section,
    textboxes,
    datasets,
    tables,
    images,
    embeddedImages,
    preserved,
    diagnostics,
  };
}
