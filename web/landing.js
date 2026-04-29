(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  // Nav glass on scroll
  window.addEventListener('scroll', () => {
    document.getElementById('nav').classList.toggle('scrolled', window.scrollY > 16);
  }, { passive: true });

  // User dropdown
  const trigger  = $('user-menu-trigger');
  const dropdown = $('user-menu-dropdown');
  if (trigger && dropdown) {
    trigger.addEventListener('click', e => {
      e.stopPropagation();
      const open = !dropdown.hidden;
      dropdown.hidden = open;
      trigger.setAttribute('aria-expanded', String(!open));
    });
    document.addEventListener('click', () => {
      dropdown.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    });
    dropdown.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        dropdown.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        trigger.focus();
      }
    });
  }

  // Install tabs
  const installTabs = document.querySelectorAll('.install-tab');
  installTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      installTabs.forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      document.querySelectorAll('.install-pane').forEach(p => p.classList.remove('active'));
      const pane = document.getElementById('install-' + tab.dataset.pane);
      if (pane) pane.classList.add('active');
    });
  });

  // Copy install command
  const copyBtn = $('install-copy-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const active = document.querySelector('.install-pane.active');
      if (!active) return;
      const text = active.querySelector('code').innerText
        .split('\n').map(l => l.replace(/^\$\s*/, '')).join('\n').trim();
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.classList.add('copied');
        copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7l3.5 3.5L12 3"/></svg>';
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="1" width="9" height="9" rx="1.5"/><path d="M1 5v7a1 1 0 0 0 1 1h7"/></svg>';
        }, 1800);
      } catch { /* ignore */ }
    });
  }

  // Sample YAML
  const sampleYaml = $('sample-yaml').textContent.trim();

  function syntaxHighlight(yaml) {
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return esc(yaml)
      .replace(/^(\s*)(#.*)$/gm, '$1<span class="hl-comment">$2</span>')
      .replace(/^(\s*)([\w\-.]+)(:)/gm, '$1<span class="hl-key">$2</span>$3')
      .replace(/(:\s*)("[^"]*"|'[^']*')/g, '$1<span class="hl-str">$2</span>');
  }

  async function render(theme) {
    const loader = $('preview-loader');
    if (loader) loader.hidden = false;
    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml: sampleYaml, theme }),
      });
      if (!res.ok) return;
      $('demo-preview').srcdoc = await res.text();
    } catch (e) {
      console.error('render error:', e);
    }
  }

  $('demo-preview').addEventListener('load', () => {
    const loader = $('preview-loader');
    if (loader) loader.hidden = true;
  });

  $('demo-theme').addEventListener('change', e => render(e.target.value));

  // Preview / YAML tab toggle
  document.querySelectorAll('.preview-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.preview-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const v = tab.dataset.view;
      $('demo-view-rendered').hidden = (v !== 'rendered');
      $('demo-view-yaml').hidden      = (v !== 'yaml');
      $('demo-theme').style.visibility = v === 'yaml' ? 'hidden' : '';
      if (v === 'yaml') $('demo-yaml-code').innerHTML = syntaxHighlight(sampleYaml);
    });
  });

  // Init theme list + render
  (async () => {
    const select = $('demo-theme');

    // If template already populated options (server-side), skip fetch
    if (!select.options.length) {
      let themes = ['sap'];
      try {
        const res = await fetch('/api/themes');
        const data = await res.json();
        if (data.themes && data.themes.length) themes = data.themes;
      } catch { /* ignore */ }

      let parsed = {};
      try { parsed = jsyaml.load(sampleYaml) || {}; } catch { /* ignore */ }
      const initial = (parsed.meta && parsed.meta.theme) || themes[0];

      for (const t of themes) {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        if (t === initial) opt.selected = true;
        select.appendChild(opt);
      }
    }

    render(select.value);
  })();
})();
