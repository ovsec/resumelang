(function () {
  'use strict';

  const vscode = acquireVsCodeApi();

  const $ = (id) => document.getElementById(id);
  const status = (msg, kind) => {
    const el = $('status');
    el.textContent = msg;
    el.className = kind || '';
  };

  let lastHTML = '';

  function showEmpty(visible) {
    $('empty').hidden = !visible;
    $('preview').style.visibility = visible ? 'hidden' : 'visible';
  }

  function showLoader(visible) {
    $('loader').hidden = !visible;
  }

  showLoader(true);

  function populateThemeSelect(themes, current) {
    const sel = $('theme-select');
    if (sel.dataset.populated === '1' && sel.options.length === themes.length) {
      sel.value = current;
      return;
    }
    sel.innerHTML = '';
    for (const t of themes) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      if (t === current) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.dataset.populated = '1';
  }

  function render(payload) {
    showEmpty(false);
    $('file-name').textContent = payload.fileName || '';
    lastHTML = payload.html || '';
    const iframe = $('preview');
    iframe.addEventListener('load', () => showLoader(false), { once: true });
    iframe.srcdoc = lastHTML;
    $('theme-info').textContent = payload.theme || '';
    status('rendered ' + new Date().toLocaleTimeString(), 'ok');
  }

  $('theme-select').addEventListener('change', (e) => {
    showLoader(true);
    status('switching theme…');
    vscode.postMessage({ type: 'set-theme', theme: e.target.value });
  });

  $('btn-print').addEventListener('click', () => {
    if (!lastHTML) {
      status('nothing to print', 'err');
      return;
    }
    status('opening in browser…');
    vscode.postMessage({ type: 'print-html', html: lastHTML });
  });

  $('btn-export').addEventListener('click', () => {
    if (!lastHTML) {
      status('nothing to export', 'err');
      return;
    }
    vscode.postMessage({ type: 'export-html', html: lastHTML });
  });

  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    switch (msg.type) {
      case 'render':
        populateThemeSelect(msg.themes || [msg.theme], msg.theme);
        render(msg);
        break;
      case 'no-doc':
        showLoader(false);
        showEmpty(true);
        status('no resume file open');
        break;
      case 'error':
        showLoader(false);
        status(msg.message || 'error', 'err');
        break;
      case 'request-export':
        if (lastHTML) vscode.postMessage({ type: 'export-html', html: lastHTML });
        break;
      case 'request-print':
        if (lastHTML) vscode.postMessage({ type: 'print-html', html: lastHTML });
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
