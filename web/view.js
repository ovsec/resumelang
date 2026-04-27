(function () {
  'use strict';

  Handlebars.registerHelper('join', (a, s) => Array.isArray(a) ? a.join(s) : '');
  Handlebars.registerHelper('eq', (a, b) => String(a) === String(b));
  Handlebars.registerHelper('default', (v, fb) => (v === undefined || v === null || v === '') ? fb : v);
  Handlebars.registerHelper('upper', (s) => String(s || '').toUpperCase());
  Handlebars.registerHelper('lower', (s) => String(s || '').toLowerCase());

  const $ = (id) => document.getElementById(id);

  function showError(msg) {
    const el = $('view-error');
    el.textContent = msg;
    el.hidden = false;
  }

  function base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function decodeShareYaml() {
    const m = location.hash.match(/^#yml=(.+)$/);
    if (!m) return null;
    let raw = m[1];
    if (raw.startsWith('g.')) {
      const bytes = base64UrlDecode(raw.slice(2));
      if ('DecompressionStream' in window) {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        const buf = await new Response(stream).arrayBuffer();
        return new TextDecoder().decode(buf);
      }
      throw new Error('browser lacks DecompressionStream');
    }
    return new TextDecoder().decode(base64UrlDecode(raw));
  }

  function mergeTokens(base, override) {
    const out = Object.assign({}, base || {});
    if (!override || typeof override !== 'object') return out;
    for (const k of Object.keys(override)) {
      const bv = out[k], ov = override[k];
      const bothMaps = bv && typeof bv === 'object' && !Array.isArray(bv)
        && ov && typeof ov === 'object' && !Array.isArray(ov);
      out[k] = bothMaps ? mergeTokens(bv, ov) : ov;
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

  let currentYaml = '';
  let currentResume = {};

  async function render(themeName) {
    if (!currentYaml) return;
    try {
      const { compiled, css, themeYml } = await loadTheme(themeName);
      const merged = mergeTokens(themeYml.tokens || {}, (currentResume.meta && currentResume.meta.tokens) || {});
      const tokens = flattenTokens(merged);
      const ctx = Object.assign({}, currentResume, { tokens, themeCSS: css });
      $('preview').srcdoc = compiled(ctx);
    } catch (e) {
      showError('render: ' + e.message);
    }
  }

  function setTitle() {
    const name = (currentResume.person && currentResume.person.name) || 'resume';
    const title = (currentResume.person && currentResume.person.title) || '';
    $('resume-title').textContent = name;
    $('resume-sub').textContent = title;
    document.title = name + ' — resumelang';
  }

  function syntaxHighlight(yamlText) {
    const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return escape(yamlText)
      .replace(/^(\s*)(#.*)$/gm, '$1<span style="color:#8b909c">$2</span>')
      .replace(/^(\s*)([\w\-.]+)(:)/gm, '$1<span style="color:#7c8cff">$2</span>$3')
      .replace(/(:\s*)("[^"]*"|'[^']*')/g, '$1<span style="color:#4ade80">$2</span>');
  }

  // Tabs
  document.querySelectorAll('.view-tabs .tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-tabs .tab').forEach(b => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      document.querySelectorAll('.view-pane').forEach(p => {
        p.hidden = (p.id !== btn.dataset.target);
      });
    });
  });

  $('btn-copy-yaml').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(currentYaml);
      $('btn-copy-yaml').textContent = 'Copied ✓';
      setTimeout(() => { $('btn-copy-yaml').textContent = 'Copy YAML'; }, 1400);
    } catch (e) {
      showError('clipboard: ' + e.message);
    }
  });

  $('btn-print').addEventListener('click', () => {
    const iframe = $('preview');
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      showError('print: ' + e.message);
    }
  });

  $('view-theme').addEventListener('change', (e) => {
    render(e.target.value);
  });

  // Init
  (async () => {
    let yamlText;
    try {
      yamlText = await decodeShareYaml();
    } catch (e) {
      showError(e.message);
      return;
    }
    if (!yamlText) {
      showError('no resume data in URL — append #yml=… or visit / to create one');
      return;
    }
    currentYaml = yamlText;
    try {
      currentResume = jsyaml.load(yamlText) || {};
    } catch (e) {
      showError('YAML: ' + e.message);
      return;
    }
    setTitle();
    $('source-code').innerHTML = syntaxHighlight(yamlText);

    // Pass YAML to "Edit copy" button
    $('btn-edit').href = '/editor' + location.hash;

    // Theme select
    const select = $('view-theme');
    let themes = ['sap'];
    try {
      const res = await fetch('/api/themes');
      const data = await res.json();
      themes = data.themes || themes;
    } catch { /* ignore */ }

    const initial = (currentResume.meta && currentResume.meta.theme) || themes[0];
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
