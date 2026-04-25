(function () {
  'use strict';

  const DEFAULT_YAML = `# yaml-language-server: $schema=https://resumelang.dev/schema/v1.json
resumelang: v1

meta:
  theme: minimal
  color: "#6366f1"
  language: en
  page_size: a4
  sections:
    - summary
    - experience
    - education
    - skills
    - projects

person:
  name: Jane Doe
  title: Senior Software Engineer
  email: jane@example.com
  location: Stockholm, Sweden
  website: https://janedoe.dev
  github: janedoe
  linkedin: janedoe

summary: |
  Experienced engineer with 8 years building distributed systems.

experience:
  - company: Acme Corp
    role: Lead Engineer
    location: Stockholm
    start: "2021"
    end: ""
    description: Led the platform team.
    highlights:
      - Scaled API to 10M requests/day
      - Reduced deploy time by 60%
    tags: [Go, Kubernetes, Postgres]

education:
  - institution: KTH
    degree: MSc
    field: Computer Science
    start: "2013"
    end: "2015"

skills:
  - category: Languages
    skills: [Go, TypeScript, Python]
  - category: Infrastructure
    skills: [Kubernetes, AWS, Postgres]

projects:
  - name: gitshare
    description: P2P git repo sharing.
    url: https://github.com/janedoe/gitshare
    tags: [Go, P2P]
`;

  const STORAGE_KEY = 'resumelang.yaml';
  const THEME_KEY = 'resumelang.theme';

  // Handlebars helpers — must match Go side
  Handlebars.registerHelper('join', function (arr, sep) {
    if (!Array.isArray(arr)) return '';
    return arr.join(sep);
  });
  Handlebars.registerHelper('eq', function (a, b) { return String(a) === String(b); });
  Handlebars.registerHelper('default', function (v, fallback) {
    return (v === undefined || v === null || v === '') ? fallback : v;
  });
  Handlebars.registerHelper('upper', function (s) { return String(s || '').toUpperCase(); });
  Handlebars.registerHelper('lower', function (s) { return String(s || '').toLowerCase(); });

  const status = (msg, kind) => {
    const el = document.getElementById('status');
    el.textContent = msg;
    el.className = 'status' + (kind ? ' ' + kind : '');
  };

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
    const compiled = Handlebars.compile(tpl);
    const data = { compiled, css, themeYml };
    themeCache.set(name, data);
    return data;
  }

  function flattenTokens(tokens, prefix, out) {
    out = out || {};
    if (!tokens || typeof tokens !== 'object') return out;
    for (const k of Object.keys(tokens)) {
      const key = prefix ? prefix + '_' + k : k;
      const v = tokens[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        flattenTokens(v, key, out);
      } else {
        out[key] = v;
      }
    }
    return out;
  }

  // Decide CM theme + body class based on resume theme background luma
  function applyEditorAppearance(themeYml) {
    const bg = (themeYml && themeYml.tokens && themeYml.tokens.colors && themeYml.tokens.colors.background) || '#ffffff';
    const luma = hexLuma(bg);
    const isDark = luma < 0.5;
    document.body.classList.toggle('cm-light', !isDark);
    cm.setOption('theme', isDark ? 'material-darker' : 'default');
  }
  function hexLuma(hex) {
    const m = String(hex).trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return 1;
    let h = m[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  let lastHTML = '';
  function render() {
    const yamlText = cm.getValue();
    localStorage.setItem(STORAGE_KEY, yamlText);

    let resume;
    try {
      resume = jsyaml.load(yamlText) || {};
    } catch (e) {
      status('YAML: ' + e.message, 'err');
      return;
    }

    const themeName = document.getElementById('theme-select').value || 'minimal';
    localStorage.setItem(THEME_KEY, themeName);

    loadTheme(themeName).then(({ compiled, css, themeYml }) => {
      applyEditorAppearance(themeYml);
      const tokens = flattenTokens(themeYml.tokens || {});
      const ctx = Object.assign({}, resume, {
        tokens,
        themeCSS: css,
      });
      try {
        const html = compiled(ctx);
        lastHTML = html;
        document.getElementById('preview').srcdoc = html;
        status('rendered ' + new Date().toLocaleTimeString(), 'ok');
      } catch (e) {
        status('render: ' + e.message, 'err');
      }
    }).catch(e => status('theme: ' + e.message, 'err'));
  }

  let renderTimer = null;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 200);
  }

  // CodeMirror
  const cm = CodeMirror.fromTextArea(document.getElementById('editor'), {
    mode: 'yaml',
    lineNumbers: true,
    theme: 'default',
    indentUnit: 2,
    tabSize: 2,
    lineWrapping: true,
  });
  cm.on('change', scheduleRender);

  // Theme dropdown
  fetch('/api/themes').then(r => r.json()).then(data => {
    const select = document.getElementById('theme-select');
    const themes = data.themes || ['minimal'];
    const saved = localStorage.getItem(THEME_KEY);
    for (const t of themes) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      if (t === saved) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', render);

    // Initial content
    const saved_yaml = localStorage.getItem(STORAGE_KEY);
    cm.setValue(saved_yaml || DEFAULT_YAML);
    render();
  }).catch(e => status('themes: ' + e.message, 'err'));

  // Print
  document.getElementById('btn-print').addEventListener('click', () => {
    const iframe = document.getElementById('preview');
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
  });

  // Splitter drag
  (function setupSplitter() {
    const splitter = document.getElementById('splitter');
    const split = document.getElementById('split');
    const SPLIT_KEY = 'resumelang.split';

    const saved = localStorage.getItem(SPLIT_KEY);
    if (saved) split.style.setProperty('--pane-split', saved);

    let dragging = false;
    let isVertical = window.matchMedia('(max-width: 700px)').matches;

    splitter.addEventListener('pointerdown', (e) => {
      dragging = true;
      isVertical = window.matchMedia('(max-width: 700px)').matches;
      splitter.classList.add('dragging');
      document.body.classList.add('dragging');
      splitter.setPointerCapture(e.pointerId);
    });
    splitter.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = split.getBoundingClientRect();
      let pct;
      if (isVertical) {
        pct = ((e.clientY - rect.top) / rect.height) * 100;
      } else {
        pct = ((e.clientX - rect.left) / rect.width) * 100;
      }
      pct = Math.max(15, Math.min(85, pct));
      const val = pct.toFixed(2) + '%';
      split.style.setProperty('--pane-split', val);
      if (isVertical) {
        split.style.gridTemplateRows = `${val} 6px 1fr`;
        split.style.gridTemplateColumns = '1fr';
      } else {
        split.style.gridTemplateColumns = `${val} 6px 1fr`;
        split.style.gridTemplateRows = '';
      }
      cm.refresh();
    });
    splitter.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      splitter.classList.remove('dragging');
      document.body.classList.remove('dragging');
      splitter.releasePointerCapture(e.pointerId);
      localStorage.setItem(SPLIT_KEY, split.style.getPropertyValue('--pane-split') || '50%');
    });
  })();

  // Download
  document.getElementById('btn-download').addEventListener('click', () => {
    if (!lastHTML) return;
    const blob = new Blob([lastHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'resume.html';
    a.click();
    URL.revokeObjectURL(url);
  });
})();
