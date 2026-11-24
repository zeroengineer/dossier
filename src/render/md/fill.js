// A minimal Mustache-like filler for Markdown template bodies (`body.md`): no HTML escaping.
import { DossierError } from '../../errors.js';

const TAG = /\{\{\s*([^{}]*?)\s*\}\}/g;
const SECTION_LINE = /^[ \t]*(\{\{\s*(?:#each|#if|else|\/each|\/if)\b[^{}]*\}\})[ \t]*(?:\r?\n|$)/gm;
const PATH = /^(?:this|@index1?|[A-Za-z_$][\w$-]*)(?:\.[\w$-]+)*$/;

const lineOf = (src, pos) => src.slice(0, pos).split('\n').length;
const syntax = (src, pos, msg) => new DossierError('TEMPLATE_SYNTAX', `line ${lineOf(src, pos)}: ${msg}`, { line: lineOf(src, pos) });

/** Parse into a tree of text / var / each / if nodes. */
function parse(src) {
  const root = { children: [] };
  const stack = [{ node: root, list: root.children, kind: 'root' }];
  let last = 0;
  for (const m of src.matchAll(TAG)) {
    const top = stack.at(-1);
    if (m.index > last) top.list.push({ t: 'text', v: src.slice(last, m.index) });
    last = m.index + m[0].length;
    const tag = m[1];
    let mm;
    if ((mm = /^#(each|if)\s+(\S+)$/.exec(tag))) {
      if (!PATH.test(mm[2])) throw syntax(src, m.index, `bad path "${mm[2]}" in {{${tag}}}`);
      const node = mm[1] === 'each' ? { t: 'each', path: mm[2], body: [] } : { t: 'if', path: mm[2], then: [], else: [] };
      top.list.push(node);
      stack.push({ node, list: node.t === 'each' ? node.body : node.then, kind: mm[1], pos: m.index });
    } else if (tag === 'else') {
      if (top.kind !== 'if' || top.list === top.node.else) throw syntax(src, m.index, '{{else}} outside {{#if}}');
      top.list = top.node.else;
    } else if ((mm = /^\/(each|if)$/.exec(tag))) {
      if (top.kind !== mm[1]) throw syntax(src, m.index, `{{/${mm[1]}}} without a matching {{#${mm[1]}}}`);
      stack.pop();
    } else if (PATH.test(tag)) {
      top.list.push({ t: 'var', path: tag });
    } else {
      throw syntax(src, m.index, `unsupported tag {{${tag}}}`);
    }
  }
  if (stack.length > 1) {
    const open = stack.at(-1);
    throw syntax(src, open.pos, `{{#${open.kind}}} is never closed`);
  }
  if (last < src.length) root.children.push({ t: 'text', v: src.slice(last) });
  return root.children;
}

function getPath(obj, parts) {
  let v = obj;
  for (const p of parts) {
    if (v == null || typeof v !== 'object') return undefined;
    v = v[p];
  }
  return v;
}

/** Resolve a path against the scope stack: `this`, `this.x`, `@index`, `@index1`, or a name looked up innermost first. */
function lookup(path, frames) {
  const top = frames.at(-1);
  if (path === '@index') return { value: top.index, full: path };
  if (path === '@index1') return { value: top.index === undefined ? undefined : top.index + 1, full: path };
  const parts = path.split('.');
  if (parts[0] === 'this') {
    const rest = parts.slice(1);
    return { value: getPath(top.value, rest), full: [top.path, ...rest].filter(Boolean).join('.') || 'this' };
  }
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i];
    if (f.value !== null && typeof f.value === 'object' && Object.hasOwn(f.value, parts[0])) {
      return { value: getPath(f.value, parts), full: [f.path, path].filter(Boolean).join('.') };
    }
  }
  return { value: undefined, full: path };
}

const truthy = (v) => (Array.isArray(v) ? v.length > 0 : v !== null && typeof v === 'object' ? Object.keys(v).length > 0 : Boolean(v));

function scalar(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.filter((x) => x !== null && typeof x !== 'object').map(String).join(', ');
  return '';
}

/**
 * Fill a Markdown body: `{{path}}` (dotted), `{{#each list}}…{{/each}}` with `{{this}}`, `{{this.x}}`, `{{@index}}`
 * (0-based) and `{{@index1}}` (1-based), `{{#if path}}…{{else}}…{{/if}}` (empty lists and objects are false). Inside
 * `each`, plain names resolve against the item first, then outer scopes. A section tag alone on its line removes the
 * line. Values are inserted as written (no escaping); a missing (undefined or null) value renders as '' and its path is
 * reported in `missing` (also a missing `each` list). Throws TEMPLATE_SYNTAX for unbalanced or unknown tags.
 * @param {string} body
 * @param {Record<string, unknown>} values
 * @returns {{ text: string, missing: string[] }}
 */
export function fillMarkdown(body, values = {}) {
  const tree = parse(String(body).replace(SECTION_LINE, '$1'));
  const missing = new Set();
  const render = (nodes, frames) => {
    let out = '';
    for (const n of nodes) {
      if (n.t === 'text') out += n.v;
      else if (n.t === 'var') {
        const { value, full } = lookup(n.path, frames);
        if (value === undefined || value === null) missing.add(full);
        else out += scalar(value);
      } else if (n.t === 'if') {
        out += render(truthy(lookup(n.path, frames).value) ? n.then : n.else, frames);
      } else {
        const { value, full } = lookup(n.path, frames);
        if (value === undefined || value === null) {
          missing.add(full);
          continue;
        }
        const list = Array.isArray(value) ? value : [value];
        list.forEach((item, index) => {
          out += render(n.body, [...frames, { value: item, index, path: `${full}.${index}` }]);
        });
      }
    }
    return out;
  };
  const text = render(tree, [{ value: values, path: '' }]);
  return { text, missing: [...missing] };
}
