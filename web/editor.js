(function () {
  'use strict';

  const DEFAULT_YAML = `# yaml-language-server: $schema=https://resumelang.dev/schema/v1.json
resumelang: v1

meta:
  theme: sap
  language: en
  page_size: a4
  sections:
    - summary
    - experience
    - education
    - skills
    - projects
    - certifications
    - languages
    - awards

person:
  name:     Ashok Saha
  title:    Senior Software Engineer
  email:    ashok@example.com
  phone:    "+1 555 000 0000"
  location: Stockholm, Sweden
  website:  https://ashoksaha.dev
  github:   ashoksaha
  linkedin: ashoksaha

summary: |
  Experienced engineer with 8 years building distributed systems.

experience:
  - company:  Acme Corp
    role:     Lead Engineer
    location: Stockholm
    start:    "2021"
    end:      ""
    highlights:
      - Scaled API to 10 M requests/day
      - Reduced CI deploy time by 60%
    tags: [Go, Kubernetes, Postgres]

education:
  - institution: KTH Royal Institute of Technology
    degree:      MSc
    field:       Computer Science
    start:       "2013"
    end:         "2015"

skills:
  - category: Languages
    skills: [Go, TypeScript, Python, Rust]
  - category: Infrastructure
    skills: [Kubernetes, Terraform, AWS, Postgres]

projects:
  - name:        gitshare
    description: P2P git repo sharing. Zero-dependency single binary.
    tags: [Go, P2P, CLI]
`;

  const STORAGE_KEY = 'resumelang.yaml';
  const THEME_KEY   = 'resumelang.theme';

  // Status toast
  let statusTimer;
  function status(msg, kind) {
    const el = document.getElementById('status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'status-toast show' + (kind ? ' ' + kind : '');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => el.classList.remove('show'), kind === 'err' ? 6000 : 2400);
  }

  // Expose YAML getter for share modal (injected as HTMX fragment)
  window.editorGetYAML = () => cm.getValue();

  // CodeMirror
  const cm = CodeMirror.fromTextArea(document.getElementById('editor'), {
    mode:         'yaml',
    lineNumbers:  true,
    theme:        'material-darker',
    indentUnit:   2,
    tabSize:      2,
    lineWrapping: true,
    extraKeys:    { Tab: c => c.execCommand('insertSoftTab') },
  });

  const yamlHidden = document.getElementById('yaml-hidden');

  let lastGoodTheme = localStorage.getItem(THEME_KEY) || 'sap';
  let prevMetaTheme = '';  // tracks last seen meta.theme from YAML
  let renderTimer;

  async function render() {
    const yaml = cm.getValue();
    localStorage.setItem(STORAGE_KEY, yaml);
    if (yamlHidden) yamlHidden.value = yaml;

    // Sync YAML view
    const yamlCode = document.getElementById('yaml-code');
    if (yamlCode) yamlCode.innerHTML = syntaxHighlight(yaml);

    let resume = {};
    try { resume = jsyaml.load(yaml) || {}; } catch { /* ignore parse errors mid-type */ }

    const select = document.getElementById('theme-select');
    const metaTheme = ((resume.meta && resume.meta.theme) || '').trim();

    // Only sync dropdown when meta.theme *changes* in the YAML — not on every render.
    // This lets the dropdown be the source of truth after the user picks a theme manually.
    if (metaTheme && metaTheme !== prevMetaTheme && select.querySelector(`option[value="${metaTheme}"]`)) {
      select.value = metaTheme;
    }
    prevMetaTheme = metaTheme;

    const theme = select.value || lastGoodTheme;

    try {
      const res = await fetch('/api/render', {
        method:  'POST',
        headers: {'Content-Type': 'application/json'},
        body:    JSON.stringify({yaml, theme}),
      });
      if (!res.ok) {
        const msg = await res.text();
        status(msg, 'err');
        // Fallback theme if the error is theme-related
        if (theme !== lastGoodTheme && msg.includes('render')) {
          reRenderWithTheme(yaml, lastGoodTheme);
        }
        return;
      }
      const html = await res.text();
      document.getElementById('preview').srcdoc = html;
      lastGoodTheme = theme;
      localStorage.setItem(THEME_KEY, theme);
      select.value = theme;
      status('rendered ' + new Date().toLocaleTimeString(), 'ok');
    } catch (e) {
      status('render: ' + e.message, 'err');
    }
  }

  async function reRenderWithTheme(yaml, theme) {
    try {
      const res = await fetch('/api/render', {
        method:  'POST',
        headers: {'Content-Type': 'application/json'},
        body:    JSON.stringify({yaml, theme}),
      });
      if (!res.ok) return;
      const html = await res.text();
      document.getElementById('preview').srcdoc = html;
      const select = document.getElementById('theme-select');
      select.value = theme;
      status(`theme not found — using "${theme}"`, 'err');
    } catch { /* ignore */ }
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 240);
  }

  cm.on('change', scheduleRender);

  // Theme dropdown → immediate re-render
  document.getElementById('theme-select')?.addEventListener('change', () => {
    clearTimeout(renderTimer);
    render();
  });

  // Pane tabs
  document.querySelectorAll('.pane-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.pane-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const v = tab.dataset.view;
      document.getElementById('view-preview').hidden = v !== 'preview';
      document.getElementById('view-yaml').hidden    = v !== 'yaml';
      if (v === 'yaml') {
        const c = document.getElementById('yaml-code');
        if (c) c.innerHTML = syntaxHighlight(cm.getValue());
      }
    });
  });

  // Print
  document.getElementById('btn-print')?.addEventListener('click', () => {
    try { document.getElementById('preview').contentWindow.print(); }
    catch (e) { status('print: ' + e.message, 'err'); }
  });

  // Download HTML (quick shortcut from top bar)
  document.getElementById('btn-download')?.addEventListener('click', async () => {
    const yaml  = cm.getValue();
    const theme = document.getElementById('theme-select').value || lastGoodTheme;
    try {
      const res = await fetch('/api/export/html', {
        method:  'POST',
        headers: {'Content-Type': 'application/json'},
        body:    JSON.stringify({yaml, theme}),
      });
      if (!res.ok) { status(await res.text(), 'err'); return; }
      const blob = await res.blob();
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob), download: 'resume.html',
      });
      a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { status('download: ' + e.message, 'err'); }
  });

  // Save (logged-in users)
  document.getElementById('btn-save')?.addEventListener('click', async () => {
    const yaml = cm.getValue();
    let name = 'My Resume';
    try {
      const r = jsyaml.load(yaml) || {};
      name = (r.person && r.person.name) ? r.person.name + '\'s Resume' : 'My Resume';
    } catch { /* ignore */ }
    try {
      const res = await fetch('/api/resumes', {
        method:  'POST',
        headers: {'Content-Type': 'application/json'},
        body:    JSON.stringify({name, yaml}),
      });
      if (!res.ok) throw new Error(await res.text());
      status('saved ✓', 'ok');
    } catch (e) { status('save: ' + e.message, 'err'); }
  });

  // YAML syntax highlighter
  function syntaxHighlight(yaml) {
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return esc(yaml)
      .replace(/^(\s*)(#.*)$/gm, '$1<span class="hl-comment">$2</span>')
      .replace(/^(\s*)([\w\-.]+)(:)/gm, '$1<span class="hl-key">$2</span>$3')
      .replace(/(:\s*)("[^"]*"|'[^']*')/g, '$1<span class="hl-str">$2</span>');
  }

  // Share link decoding on load (for /editor#yml=... deep links)
  (async function init() {
    let yaml = await decodeShareYaml() || localStorage.getItem(STORAGE_KEY);
    if (!yaml) {
      // Ask server: resume.yml in cwd → examples/ → 204 (use stub)
      try {
        const res = await fetch('/api/default-yaml');
        yaml = res.ok && res.status !== 204 ? await res.text() : DEFAULT_YAML;
      } catch { yaml = DEFAULT_YAML; }
    }
    cm.setValue(yaml);
    if (yamlHidden) yamlHidden.value = yaml;

    // Restore saved theme in dropdown
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) {
      const sel = document.getElementById('theme-select');
      if (sel && sel.querySelector(`option[value="${saved}"]`)) {
        sel.value = saved;
      }
    }
    render();
  })();

  async function decodeShareYaml() {
    const m = location.hash.match(/^#yml=(.+)$/);
    if (!m) return null;
    const raw = m[1];
    if (raw.startsWith('g.')) {
      const bytes = b64urlDecode(raw.slice(2));
      if ('DecompressionStream' in window) {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        return new TextDecoder().decode(await new Response(stream).arrayBuffer());
      }
      return null;
    }
    if (raw.startsWith('p.')) return null; // encrypted — can't decode without password
    return new TextDecoder().decode(b64urlDecode(raw));
  }

  function b64urlDecode(str) {
    const b64 = (str + '='.repeat((4 - str.length % 4) % 4)).replace(/-/g,'+').replace(/_/g,'/');
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Splitter drag
  (function () {
    const splitter  = document.getElementById('splitter');
    const workspace = document.getElementById('split');
    const SPLIT_KEY = 'resumelang.split';
    const saved = localStorage.getItem(SPLIT_KEY);
    if (saved) workspace.style.setProperty('--pane-split', saved);
    let dragging = false, isVert = false;
    splitter.addEventListener('pointerdown', e => {
      dragging = true;
      isVert = window.matchMedia('(max-width: 760px)').matches;
      splitter.classList.add('dragging');
      document.body.classList.add('dragging');
      splitter.setPointerCapture(e.pointerId);
    });
    splitter.addEventListener('pointermove', e => {
      if (!dragging) return;
      const rect = workspace.getBoundingClientRect();
      let pct = isVert
        ? ((e.clientY - rect.top)  / rect.height) * 100
        : ((e.clientX - rect.left) / rect.width)  * 100;
      pct = Math.max(15, Math.min(85, pct));
      const val = pct.toFixed(2) + '%';
      workspace.style.setProperty('--pane-split', val);
      if (isVert) { workspace.style.gridTemplateRows = `${val} 3px 1fr`; workspace.style.gridTemplateColumns = ''; }
      else        { workspace.style.gridTemplateColumns = `${val} 3px 1fr`; workspace.style.gridTemplateRows = ''; }
      cm.refresh();
    });
    splitter.addEventListener('pointerup', e => {
      if (!dragging) return;
      dragging = false;
      splitter.classList.remove('dragging');
      document.body.classList.remove('dragging');
      splitter.releasePointerCapture(e.pointerId);
      localStorage.setItem(SPLIT_KEY, workspace.style.getPropertyValue('--pane-split') || '50%');
    });
  })();
})();
