(function () {
  'use strict';

  Handlebars.registerHelper('join', (a, s) => Array.isArray(a) ? a.join(s) : '');
  Handlebars.registerHelper('eq', (a, b) => String(a) === String(b));
  Handlebars.registerHelper('default', (v, fb) => (v === undefined || v === null || v === '') ? fb : v);
  Handlebars.registerHelper('upper', (s) => String(s || '').toUpperCase());
  Handlebars.registerHelper('lower', (s) => String(s || '').toLowerCase());

  const $ = id => document.getElementById(id);

  // Nav glass on scroll
  const nav = document.getElementById('nav');
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 16);
  }, { passive: true });

  // Sample YAML
  const sampleYaml = $('sample-yaml').textContent.trim();
  let resume = {};
  try { resume = jsyaml.load(sampleYaml) || {}; } catch (e) { console.error(e); }

  // Theme loader (cached)
  const themeCache = new Map();
  async function loadTheme(name) {
    if (themeCache.has(name)) return themeCache.get(name);
    const [tplRes, cssRes, ymlRes] = await Promise.all([
      fetch(`/themes/${name}/templates/resume.hbs`),
      fetch(`/themes/${name}/assets/style.css`),
      fetch(`/themes/${name}/theme.yml`),
    ]);
    if (!tplRes.ok) throw new Error(`template missing for ${name}`);
    const tpl = await tplRes.text();
    const css = cssRes.ok ? await cssRes.text() : '';
    const ymlText = ymlRes.ok ? await ymlRes.text() : '';
    const themeYml = ymlText ? jsyaml.load(ymlText) || {} : {};
    const data = { compiled: Handlebars.compile(tpl), css, themeYml };
    themeCache.set(name, data);
    return data;
  }

  function mergeTokens(base, override) {
    const out = Object.assign({}, base || {});
    if (!override || typeof override !== 'object') return out;
    for (const k of Object.keys(override)) {
      const bv = out[k], ov = override[k];
      const both = bv && typeof bv === 'object' && !Array.isArray(bv)
        && ov && typeof ov === 'object' && !Array.isArray(ov);
      out[k] = both ? mergeTokens(bv, ov) : ov;
    }
    return out;
  }
  function flattenTokens(tokens, prefix, out) {
    out = out || {};
    if (!tokens || typeof tokens !== 'object') return out;
    for (const k of Object.keys(tokens)) {
      const key = prefix ? prefix + '_' + k : k;
      const v = tokens[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) flattenTokens(v, key, out);
      else out[key] = v;
    }
    return out;
  }

  async function render(themeName) {
    const loader = $('preview-loader');
    if (loader) loader.hidden = false;
    try {
      const { compiled, css, themeYml } = await loadTheme(themeName);
      const merged = mergeTokens(themeYml.tokens || {}, (resume.meta && resume.meta.tokens) || {});
      const tokens = flattenTokens(merged);
      const ctx = Object.assign({}, resume, { tokens, themeCSS: css });
      $('demo-preview').srcdoc = compiled(ctx);
    } catch (e) {
      console.error('render error:', e);
    }
  }

  function syntaxHighlight(yaml) {
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return esc(yaml)
      .replace(/^(\s*)(#.*)$/gm, '$1<span class="hl-comment">$2</span>')
      .replace(/^(\s*)([\w\-.]+)(:)/gm, '$1<span class="hl-key">$2</span>$3')
      .replace(/(:\s*)("[^"]*"|'[^']*')/g, '$1<span class="hl-str">$2</span>');
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
      if (v === 'yaml') {
        $('demo-yaml-code').innerHTML = syntaxHighlight(sampleYaml);
      }
    });
  });

  // Auth / user widget
  const PROVIDERS = {
    github:   { label: 'GitHub',   svg: '<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.69.08-.69 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11.04 11.04 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.26 5.69.41.36.78 1.06.78 2.13v3.16c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"/></svg>' },
    linkedin: { label: 'LinkedIn', svg: '<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.36V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45Z"/></svg>' },
  };

  fetch('/api/me', { credentials: 'same-origin' })
    .then(r => r.json())
    .then(data => {
      if (data && data.user) {
        const chip = $('nav-user');
        chip.hidden = false;
        $('nav-avatar').src = data.user.avatar || '/web/favicon.svg';
        $('nav-name').textContent = data.user.name || data.user.login || data.user.provider;
      } else if (Array.isArray(data && data.providers) && data.providers.length) {
        $('nav-signin').hidden = false;
        const wrap = $('hero-providers');
        const list = $('provider-buttons');
        wrap.hidden = false;
        for (const p of data.providers) {
          const meta = PROVIDERS[p] || { label: p, svg: '' };
          const a = document.createElement('a');
          a.className = 'provider-btn';
          a.href = `/auth/${p}`;
          a.innerHTML = `${meta.svg}<span>Continue with ${meta.label}</span>`;
          list.appendChild(a);
        }
      }
    })
    .catch(() => {});

  // Init theme list + render
  (async () => {
    let themes = ['sap'];
    try {
      const res = await fetch('/api/themes');
      const data = await res.json();
      themes = data.themes && data.themes.length ? data.themes : themes;
    } catch { /* ignore */ }

    const select = $('demo-theme');
    const initial = (resume.meta && resume.meta.theme) || themes[0];
    for (const t of themes) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      if (t === initial) opt.selected = true;
      select.appendChild(opt);
    }
    render(select.value);
  })();
})();
