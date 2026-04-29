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
