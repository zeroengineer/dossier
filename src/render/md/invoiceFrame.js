// Markdown summary of the invoice family frame: the frame model (src/render/pdf/invoiceFrame.js) as blocks, which
// blocksToMarkdown turns into the Markdown rendition.

const label = (s) => String(s ?? '').replace(/:\s*$/, '');
const lines = (...parts) => parts.flat().filter((x) => x !== undefined && x !== null && x !== '').join('\n');

/**
 * Blocks summarising an invoice model: title, number and date, parties, the item table with the calc rows and total
 * as total rows, bank details or the acknowledgement, the signatory, the declaration and the thank-you line.
 * @param {ReturnType<typeof import('../pdf/invoiceFrame.js').invoiceModel>} model
 * @returns {Array<object>}
 */
export function invoiceBlocks(model) {
  const columns = model.columns.map((c) => ({ key: c.key, label: c.label, ...(c.align !== 'left' ? { align: c.align } : {}) }));
  const labelKey = model.columns.find((c) => c.key === 'description')?.key ?? model.columns[0]?.key;
  const totalRow = (l, v) => ({ [labelKey]: l, amount: v });
  const blocks = [
    { type: 'heading', level: 1, text: model.title },
    { type: 'keyValue', rows: [[label(model.number.label), model.number.value], [label(model.date.label), model.date.value]] },
    { type: 'heading', level: 2, text: model.party.label },
    { type: 'paragraph', text: lines(model.party.name, model.party.address), align: 'left' },
    { type: 'heading', level: 2, text: model.from.label },
    { type: 'paragraph', text: lines(model.from.name, model.from.address, model.from.contacts.map((c) => `${c.label}: ${c.value}`)), align: 'left' },
    {
      type: 'table',
      columns,
      rows: model.rows,
      totalRows: [...model.calc.map((r) => totalRow(r.label, r.value)), totalRow(model.total.label, model.total.value)],
    },
  ];
  if (model.bank) {
    blocks.push({ type: 'heading', level: 2, text: model.bank.title }, { type: 'keyValue', rows: model.bank.lines.map((l) => [l.label, l.value]) });
  } else if (model.acknowledgement) {
    blocks.push({ type: 'heading', level: 2, text: model.acknowledgement.title }, { type: 'paragraph', text: model.acknowledgement.text });
  }
  if (model.signatory) {
    blocks.push({ type: 'signature', signatoryId: model.signatory.id, party: model.signatory.forLine });
  }
  if (model.declaration.text) blocks.push({ type: 'paragraph', text: `**${model.declaration.title}**\n${model.declaration.text}` });
  if (model.thankYou) blocks.push({ type: 'paragraph', text: model.thankYou, align: 'center' });
  return blocks;
}
