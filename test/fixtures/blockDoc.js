// A block document exercising every block type (fake content only).
export const PARAGRAPH = 'This letter sets out the **terms of engagement**, the schedule of deliverables, the fees payable and the '
  + 'obligations of each party for the duration of the engagement. Each party confirms that it has read and understood '
  + 'these terms <and> agrees to be bound by them in full & without reservation.';

export const BLOCK_DOC = [
  { type: 'heading', level: 1, text: 'Terms of engagement' },
  { type: 'heading', level: 2, text: '1. Scope & <duties>' },
  { type: 'paragraph', text: PARAGRAPH },
  { type: 'bullets', items: ['First item with **bold** words', 'Second item'] },
  { type: 'numbered', items: ['Step one', 'Step two'] },
  {
    type: 'table',
    columns: [{ label: 'Earnings', width: 200 }, { label: 'Monthly', width: 150, align: 'right' }, { label: 'Annual', align: 'right' }],
    rows: [['Basic', '10,000', '1,20,000'], ['Allowance | other', '2,000', '24,000']],
    totalRows: [['Gross', '12,000', '1,44,000']],
  },
  { type: 'keyValue', rows: [['Event', 'Example Annual Meet'], ['Issued to', 'Example Client Org']] },
  { type: 'divider' },
  { type: 'spacer', size: 12 },
  { type: 'heading', level: 3, text: 'Acceptance' },
  { type: 'paragraph', text: 'Centred line', align: 'center' },
  { type: 'pageBreak' },
  { type: 'signature', signatoryId: 'md', lines: ['Authorized Signatory'] },
  { type: 'signature', party: 'For Example Client Org', lines: ['Name:', 'Date:'] },
  { type: 'custom', name: 'box', data: { html: '<div class="box">custom</div>', md: '> custom block', fill: '#cccccc' } },
];
