// Test fixture template (fake content only).

/** Computed fields: amounts are integer minor units. */
export const computed = {
  annual: (values) => (values.salary === undefined ? undefined : values.salary * 12),
};

/** A small offer-letter style block document. */
export function blocks(values, env) {
  return [
    { type: 'heading', level: 1, text: env.params.subject },
    { type: 'paragraph', text: `Dear **${values.person?.name ?? ''}**, we are pleased to offer you a position.` },
    { type: 'bullets', items: ['First term', 'Second term'] },
    { type: 'signature', signatoryId: values.signatory?.id, lines: ['Authorized Signatory'] },
  ];
}

export const style = { paragraph: { fontSize: 10.5 } };

export const pdfCustom = {
  box: (ctx, data) => {
    ctx.doc.rect(ctx.profile.ML, ctx.doc.y, 50, 10).fill(data.fill ?? '#000000');
  },
};
