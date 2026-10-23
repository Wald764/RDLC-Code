/** Documented SC-004/005/009 reference report: 100 selectable textboxes padded to exactly 1 MiB. */
export function referenceReport(): string {
  const items = Array.from({ length: 100 }, (_, index) => {
    const row = Math.floor(index / 10),
      column = index % 10;
    return `<Textbox Name="Item${index + 1}"><Top>${(row * 0.4).toFixed(2)}in</Top><Left>${(column * 0.65).toFixed(2)}in</Left><Height>0.3in</Height><Width>0.6in</Width><Paragraphs><Paragraph><TextRuns><TextRun><Value>Item ${index + 1}</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox>`;
  }).join('\n');
  const head = `<?xml version="1.0" encoding="utf-8"?>
<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition">
  <ReportSections><ReportSection>
    <Body><ReportItems>
${items}
</ReportItems><Height>4.25in</Height></Body>
    <Width>6.5in</Width>
    <Page><PageHeight>11in</PageHeight><PageWidth>8.5in</PageWidth><LeftMargin>1in</LeftMargin><RightMargin>1in</RightMargin><TopMargin>1in</TopMargin><BottomMargin>1in</BottomMargin></Page>
  </ReportSection></ReportSections>
<!-- `;
  const tail = ` -->
</Report>
`;
  return head + 'x'.repeat(1048576 - head.length - tail.length) + tail;
}
