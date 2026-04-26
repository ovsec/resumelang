(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  let themes = [];
  let activeTheme = null;
  let filter = '';

  function showLoader(visible) {
    $('loader').hidden = !visible;
  }

  function setStatus(msg) {
    $('status').textContent = msg;
  }

  function setActive(name) {
    activeTheme = name;
    $('active-info').textContent = name ? 'active: ' + name : '';
    document.querySelectorAll('.card').forEach((c) => {
      c.classList.toggle('active', c.dataset.name === name);
    });
  }

  function renderGrid() {
    const grid = $('grid');
    grid.innerHTML = '';
    const q = filter.trim().toLowerCase();
    const visible = themes.filter((t) => !q || t.name.toLowerCase().includes(q));
    $('count').textContent = `${visible.length} / ${themes.length}`;

    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = q ? `no themes match "${q}"` : 'no themes available';
      grid.appendChild(empty);
      return;
    }

    for (const t of visible) {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.name = t.name;
      if (t.name === activeTheme) card.classList.add('active');

      const thumb = document.createElement('div');
      thumb.className = 'thumb';

      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', '');
      iframe.setAttribute('referrerpolicy', 'no-referrer');
      iframe.setAttribute('loading', 'lazy');
      iframe.srcdoc = t.html;

      const cover = document.createElement('div');
      cover.className = 'thumb-cover';

      thumb.appendChild(iframe);
      thumb.appendChild(cover);

      const body = document.createElement('div');
      body.className = 'card-body';

      const name = document.createElement('span');
      name.className = 'card-name';
      name.textContent = t.name;

      const meta = document.createElement('span');
      meta.className = 'card-meta';
      meta.textContent = t.version ? 'v' + t.version : '';

      body.appendChild(name);
      body.appendChild(meta);

      card.appendChild(thumb);
      card.appendChild(body);

      card.addEventListener('click', () => {
        setStatus('applying ' + t.name + '…');
        setActive(t.name);
        vscode.postMessage({ type: 'apply-theme', theme: t.name });
      });

      grid.appendChild(card);
    }
  }

  $('search').addEventListener('input', (e) => {
    filter = e.target.value;
    renderGrid();
  });

  $('btn-close').addEventListener('click', () => {
    vscode.postMessage({ type: 'close' });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('search').value) {
        $('search').value = '';
        filter = '';
        renderGrid();
      } else {
        vscode.postMessage({ type: 'close' });
      }
    }
    if (e.key === '/' && document.activeElement !== $('search')) {
      e.preventDefault();
      $('search').focus();
    }
  });

  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    switch (msg.type) {
      case 'init':
        themes = msg.themes || [];
        activeTheme = msg.active || null;
        showLoader(false);
        setActive(activeTheme);
        renderGrid();
        setStatus('click a theme to apply · / to search · esc to close');
        break;
      case 'set-active':
        setActive(msg.theme);
        break;
      case 'error':
        showLoader(false);
        setStatus('error: ' + (msg.message || 'unknown'));
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
