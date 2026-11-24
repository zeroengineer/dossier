// Progressive enhancement for the generate form: add/remove array rows, and preview without leaving the page.
// Every page works without this script.
(function () {
  'use strict';

  function renumber(tbody, name) {
    Array.prototype.forEach.call(tbody.rows, function (tr, i) {
      tr.querySelectorAll('[name]').forEach(function (el) {
        var rest = el.name.slice(name.length + 1).replace(/^[^.]*/, '');
        el.name = name + '.' + i + rest;
      });
    });
  }

  document.addEventListener('click', function (ev) {
    var add = ev.target.closest('[data-add-row]');
    if (add) {
      var name = add.getAttribute('data-add-row');
      var table = document.querySelector('table[data-rows="' + CSS.escape(name) + '"]');
      var tpl = document.querySelector('template[data-row-template="' + CSS.escape(name) + '"]');
      if (!table || !tpl) return;
      var tbody = table.tBodies[0];
      tbody.appendChild(tpl.content.cloneNode(true));
      renumber(tbody, name);
      var first = tbody.rows[tbody.rows.length - 1].querySelector('input, textarea, select');
      if (first) first.focus();
      return;
    }
    var remove = ev.target.closest('[data-remove-row]');
    if (remove) {
      var tr = remove.closest('tr');
      var t = remove.closest('table[data-rows]');
      if (!tr || !t) return;
      var tb = t.tBodies[0];
      if (tb.rows.length > 1) tr.remove();
      else tr.querySelectorAll('input, textarea, select').forEach(function (el) { el.value = ''; });
      renumber(tb, t.getAttribute('data-rows'));
    }
  });

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function noticeBox(kind, heading, items) {
    var box = el('div', { class: 'notice ' + kind, role: kind === 'error' ? 'alert' : 'status' });
    box.appendChild(el('strong', {}, heading));
    if (items.length) {
      var ul = el('ul');
      items.forEach(function (t) { ul.appendChild(el('li', {}, t)); });
      box.appendChild(ul);
    }
    return box;
  }

  var form = document.getElementById('gen-form');
  if (!form || !window.fetch) return;
  form.addEventListener('submit', function (ev) {
    var submitter = ev.submitter;
    if (!submitter || submitter.value !== 'preview') return;
    ev.preventDefault();
    var body = new URLSearchParams(new FormData(form));
    body.set('$action', 'preview');
    var panel = document.getElementById('preview-body');
    var problems = document.getElementById('problems');
    submitter.disabled = true;
    panel.setAttribute('aria-busy', 'true');
    fetch(form.getAttribute('data-preview-url'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
      credentials: 'same-origin',
    }).then(function (res) { return res.json(); }).then(function (r) {
      problems.textContent = '';
      panel.textContent = '';
      if (r.code) { problems.appendChild(noticeBox('error', r.code + ': ' + r.message, [])); return; }
      if (!r.ok) {
        if (r.missing && r.missing.length) problems.appendChild(noticeBox('error', 'Required fields are empty:', r.missing.map(function (m) { return m.label + ' (' + m.name + ')'; })));
        if (r.errors && r.errors.length) problems.appendChild(noticeBox('error', 'Some values are not valid:', r.errors.map(function (e) { return e.name + ': ' + e.message; })));
        return;
      }
      if (r.warnings.length) panel.appendChild(noticeBox('warning', 'Placeholders that print empty:', r.warnings.map(function (w) { return w.name + ' — ' + w.message; })));
      var links = el('p', { class: 'muted' }, 'Draft renditions: ');
      var stamp = '?v=' + Date.now();
      r.renditions.forEach(function (x) {
        links.appendChild(el('a', { href: x.url + stamp, target: '_blank', rel: 'noopener' }, x.kind));
        links.appendChild(document.createTextNode(' '));
      });
      panel.appendChild(links);
      var pdf = r.renditions.filter(function (x) { return x.kind === 'pdf'; })[0];
      if (pdf) panel.appendChild(el('iframe', { class: 'pdf', id: 'preview-frame', title: 'Draft preview', src: pdf.url + stamp }));
    }).catch(function (err) {
      problems.textContent = '';
      problems.appendChild(noticeBox('error', 'Preview failed: ' + err.message, []));
    }).then(function () {
      submitter.disabled = false;
      panel.removeAttribute('aria-busy');
    });
  });
}());
