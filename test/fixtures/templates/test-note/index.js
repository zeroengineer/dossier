// Test fixture template for the generator (fake content only).

/** A short note as blocks; `env.draft` decides whether DRAFT is printed in place of the number. */
export function blocks(values, env) {
  // Lets a test act between the number peek and the allocation (e.g. another connection taking the number).
  globalThis.__dossierRenderHook?.(values, env);
  const out = [
    { type: 'heading', level: 1, text: env.params.heading },
    { type: 'keyValue', rows: [['No.', env.draft ? 'DRAFT' : values.number ?? ''], ['Date', env.fmt.date(values.date)], ['To', values.person.name]] },
    { type: 'heading', level: 2, text: values.subject },
    { type: 'paragraph', text: values.body },
  ];
  if (values.total !== undefined) out.push({ type: 'paragraph', text: `Amount: **${env.fmt.money(values.total)}**` });
  out.push({ type: 'signature', signatoryId: values.signatory.id });
  return out;
}
