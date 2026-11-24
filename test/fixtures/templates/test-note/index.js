// Test fixture template for the generator (fake content only).

/** A short note as blocks; the number prints as DRAFT until one is allocated. */
export function blocks(values, env) {
  const out = [
    { type: 'heading', level: 1, text: env.params.heading },
    { type: 'keyValue', rows: [['No.', values.number ?? 'DRAFT'], ['Date', env.fmt.date(values.date)], ['To', values.person.name]] },
    { type: 'heading', level: 2, text: values.subject },
    { type: 'paragraph', text: values.body },
  ];
  if (values.total !== undefined) out.push({ type: 'paragraph', text: `Amount: **${env.fmt.money(values.total)}**` });
  out.push({ type: 'signature', signatoryId: values.signatory.id });
  return out;
}
