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

  const STORAGE_KEY      = 'resumelang.yaml';
  const THEME_KEY        = 'resumelang.theme';
  const RENDER_MODE_KEY  = 'resumelang.renderMode';

  let currentTheme      = localStorage.getItem(THEME_KEY) || 'sap';
  let autoRender        = localStorage.getItem(RENDER_MODE_KEY) !== 'manual';
  let currentResumeId   = null;
  let currentResumeName = null;

  const IS_TOUCH = navigator.maxTouchPoints > 1 || 'ontouchstart' in window;
  const mq760    = window.matchMedia('(max-width: 760px)');
  const isMobile = () => mq760.matches;

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

  // ── Schema-aware YAML autocomplete ──────────────────────────────────────────

  const SCHEMA = {
    // top-level keys
    '': ['meta', 'person', 'summary', 'experience', 'education', 'skills',
         'projects', 'certifications', 'languages', 'awards', 'publications',
         'volunteer', 'custom'],

    // meta sub-keys + value completions
    'meta':            ['theme', 'language', 'page_size', 'color', 'font', 'sections'],
    'meta.theme':      ['sap', 'minimal', 'bold', 'developer'],
    'meta.page_size':  ['a4', 'letter'],
    'meta.language':   ['en', 'de', 'fr', 'es', 'pt', 'nl', 'sv', 'da', 'fi', 'no', 'it', 'pl', 'ja', 'zh'],
    'meta.font':       ['inter', 'mono', 'serif'],
    'meta.sections':   ['summary', 'experience', 'education', 'skills', 'projects',
                        'certifications', 'languages', 'awards', 'publications',
                        'volunteer', 'custom'],

    // person
    'person': ['name', 'title', 'email', 'phone', 'location', 'website', 'github', 'linkedin'],

    // experience list item
    'experience': ['company', 'role', 'location', 'start', 'end', 'description', 'highlights', 'tags', 'url'],

    // education list item
    'education': ['institution', 'degree', 'field', 'start', 'end', 'gpa', 'url'],

    // skills list item
    'skills': ['category', 'skills'],

    // projects list item
    'projects': ['name', 'description', 'url', 'highlights', 'tags'],

    // certifications list item
    'certifications': ['name', 'issuer', 'date', 'url', 'description'],

    // languages list item
    'languages': ['language', 'fluency'],
    'languages.fluency': ['native', 'fluent', 'professional', 'conversational', 'elementary'],

    // awards list item
    'awards': ['title', 'date', 'awarder', 'summary'],

    // publications list item
    'publications': ['name', 'publisher', 'date', 'url', 'summary'],

    // volunteer list item
    'volunteer': ['organization', 'role', 'start', 'end', 'url', 'summary', 'highlights'],
  };

  // Walk upward to find the nearest parent key at lower indentation.
  // Returns e.g. 'meta', 'experience', 'meta.theme', etc.
  function getParentContext(editor, cursor) {
    const lineIndent = editor.getLine(cursor.line).match(/^(\s*)/)[1].length;

    // Collect ancestor keys by walking backward
    let ancestors = [];
    let lastIndent = lineIndent;

    for (let i = cursor.line - 1; i >= 0; i--) {
      const l = editor.getLine(i);
      if (!l.trim()) continue;
      const m = l.match(/^(\s*)([\w-]+)\s*:/);
      if (!m) continue;
      const indentLen = m[1].length;
      if (indentLen < lastIndent) {
        ancestors.unshift(m[2]);
        lastIndent = indentLen;
        if (indentLen === 0) break;
      }
    }

    // Build dotted path, but only keep meaningful segments (skip list-level keys like '-')
    return ancestors.join('.');
  }

  function yamlSchemaHint(editor) {
    const cursor = editor.getCursor();
    const line   = editor.getLine(cursor.line);

    // Extract the word being typed (key or value after ': ')
    const beforeCursor = line.slice(0, cursor.ch);

    // Detect if we're completing a value (after ': ' or '- ')
    const valueMatch = beforeCursor.match(/(?::\s*|-\s+)([\w-]*)$/);
    const keyMatch   = beforeCursor.match(/^(\s*)([\w-]*)$/);

    let word = '';
    let from, to;

    if (valueMatch) {
      word = valueMatch[1];
      const wordStart = cursor.ch - word.length;
      from = CodeMirror.Pos(cursor.line, wordStart);
      to   = CodeMirror.Pos(cursor.line, cursor.ch);
    } else if (keyMatch) {
      word = keyMatch[2];
      const wordStart = keyMatch[1].length;
      from = CodeMirror.Pos(cursor.line, wordStart);
      to   = CodeMirror.Pos(cursor.line, cursor.ch);
    } else {
      return null;
    }

    const context = getParentContext(editor, cursor);

    // For value completion, check for specific key=value contexts
    let candidates = [];

    if (valueMatch) {
      // Try exact context first (e.g. 'meta.theme'), then parent alone
      const keyOnLine = line.match(/^(\s*)([\w-]+)\s*:\s*/);
      if (keyOnLine) {
        const fullKey = context ? context + '.' + keyOnLine[2] : keyOnLine[2];
        candidates = SCHEMA[fullKey] || SCHEMA[keyOnLine[2]] || [];
      }
      // List item value (after '- ')
      if (!candidates.length) {
        candidates = SCHEMA[context] || SCHEMA[''] || [];
      }
    } else {
      // Key completion
      candidates = SCHEMA[context] || SCHEMA[''] || [];
    }

    const list = candidates.filter(c => c.startsWith(word));
    if (!list.length) return null;

    return { list, from, to };
  }

  // ── Self-contained hint widget ───────────────────────────────────────────────

  let hintWidget = null;

  function closeHint() {
    if (hintWidget) { hintWidget.remove(); hintWidget = null; }
  }

  function applyHint(editor, item, from, to) {
    editor.replaceRange(item, from, to);
    closeHint();
  }

  function showSchemaHint(editor) {
    closeHint();
    const result = yamlSchemaHint(editor);
    if (!result || !result.list.length) return;
    const { list, from, to } = result;

    // Position at cursor
    const coords = editor.charCoords(from, 'window');

    const ul = document.createElement('ul');
    ul.className = 'rl-hints';
    ul.style.cssText = `left:${coords.left}px;top:${coords.bottom + 2}px`;

    let active = 0;

    function highlight(idx) {
      ul.querySelectorAll('li').forEach((li, i) => li.classList.toggle('active', i === idx));
      active = idx;
    }

    list.forEach((item, idx) => {
      const li = document.createElement('li');
      li.textContent = item;
      li.addEventListener('mousedown', e => {
        e.preventDefault();
        applyHint(editor, item, from, to);
      });
      ul.appendChild(li);
    });

    document.body.appendChild(ul);
    hintWidget = ul;
    highlight(0);

    // Keyboard nav (capture phase so CM doesn't swallow keys)
    function onKey(e) {
      if (!hintWidget) return;
      const items = ul.querySelectorAll('li');
      if (e.key === 'ArrowDown')  { e.preventDefault(); highlight((active + 1) % items.length); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); highlight((active - 1 + items.length) % items.length); }
      else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applyHint(editor, list[active], from, to);
        editor.focus();
      } else if (e.key === 'Escape') { closeHint(); }
      else { return; }
    }

    editor.getWrapperElement().addEventListener('keydown', onKey, true);

    // Close on outside click or cursor move away
    const cleanup = () => { closeHint(); editor.getWrapperElement().removeEventListener('keydown', onKey, true); };
    document.addEventListener('mousedown', e => { if (hintWidget && !hintWidget.contains(e.target)) cleanup(); }, { once: true });
    editor.on('cursorActivity', function onActivity() {
      if (!hintWidget) { editor.off('cursorActivity', onActivity); return; }
      // keep open while still on same line
      const cur = editor.getCursor();
      if (cur.line !== from.line) { cleanup(); editor.off('cursorActivity', onActivity); }
    });
  }

  // ── CodeMirror init ──────────────────────────────────────────────────────────

  function toggleComment(editor) {
    const sel = editor.listSelections()[0];
    const fromLine = Math.min(sel.anchor.line, sel.head.line);
    const toLine   = Math.max(sel.anchor.line, sel.head.line);
    // determine: all lines commented?
    const allCommented = Array.from({length: toLine - fromLine + 1}, (_, i) => fromLine + i)
      .every(ln => /^(\s*)# ?/.test(editor.getLine(ln)));
    editor.operation(() => {
      for (let ln = fromLine; ln <= toLine; ln++) {
        const text = editor.getLine(ln);
        if (allCommented) {
          editor.replaceRange(text.replace(/^(\s*)# ?/, '$1'), {line: ln, ch: 0}, {line: ln, ch: text.length});
        } else {
          editor.replaceRange('# ' + text, {line: ln, ch: 0}, {line: ln, ch: text.length});
        }
      }
    });
  }

  // CodeMirror
  const cm = CodeMirror.fromTextArea(document.getElementById('editor'), {
    mode:         'yaml',
    lineNumbers:  true,
    theme:        'material-darker',
    indentUnit:   2,
    tabSize:      2,
    lineWrapping: false,
    extraKeys: {
      Tab:           c => c.execCommand('insertSoftTab'),
      'Ctrl-Space':  c => showSchemaHint(c),
      'Ctrl-Enter':  () => { clearTimeout(renderTimer); render(); },
      'Ctrl-/':      c => toggleComment(c),
      'Cmd-/':       c => toggleComment(c),
    },
  });

  const yamlHidden = document.getElementById('yaml-hidden');

  let lastGoodTheme = localStorage.getItem(THEME_KEY) || 'sap';
  let prevMetaTheme = '';  // tracks last seen meta.theme from YAML
  let renderTimer;

  async function render() {
    const yaml = cm.getValue();
    localStorage.setItem(STORAGE_KEY, yaml);
    if (yamlHidden) yamlHidden.value = yaml;

    const yamlCode = document.getElementById('yaml-code');
    if (yamlCode) yamlCode.innerHTML = syntaxHighlight(yaml);

    let resume = {};
    try { resume = jsyaml.load(yaml) || {}; } catch { /* ignore parse errors mid-type */ }

    const metaTheme = ((resume.meta && resume.meta.theme) || '').trim();
    if (metaTheme && metaTheme !== prevMetaTheme && themeExists(metaTheme)) {
      setTheme(metaTheme, false);
    }
    prevMetaTheme = metaTheme;

    const theme = currentTheme || lastGoodTheme;

    try {
      const res = await fetch('/api/render', {
        method:  'POST',
        headers: {'Content-Type': 'application/json'},
        body:    JSON.stringify({yaml, theme}),
      });
      if (!res.ok) {
        const msg = await res.text();
        status(msg, 'err');
        if (theme !== lastGoodTheme && msg.includes('render')) {
          reRenderWithTheme(yaml, lastGoodTheme);
        }
        return;
      }
      const html = await res.text();
      document.getElementById('preview').srcdoc = html;
      lastGoodTheme = theme;
      setTheme(theme, false);
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
      setTheme(theme, false);
      status(`theme not found — using "${theme}"`, 'err');
    } catch { /* ignore */ }
  }

  // ── Theme picker ─────────────────────────────────────────────────────────────

  function themeExists(name) {
    const sel = document.getElementById('theme-select');
    return !!sel?.querySelector(`option[value="${name}"]`);
  }

  function setTheme(name, doRender = true) {
    currentTheme = name;
    localStorage.setItem(THEME_KEY, name);
    const label = document.getElementById('theme-picker-label');
    if (label) label.textContent = name;
    const sel = document.getElementById('theme-select');
    if (sel) sel.value = name;
    document.querySelectorAll('.theme-picker-item').forEach(li => {
      const active = li.dataset.theme === name;
      li.classList.toggle('active', active);
      li.setAttribute('aria-selected', String(active));
    });
    if (doRender) { clearTimeout(renderTimer); render(); }
  }

  function closePicker() {
    const menu = document.getElementById('theme-picker-menu');
    const btn  = document.getElementById('theme-picker-btn');
    if (menu) menu.hidden = true;
    if (btn)  btn.setAttribute('aria-expanded', 'false');
  }

  function initThemePicker(themes) {
    const btn  = document.getElementById('theme-picker-btn');
    const menu = document.getElementById('theme-picker-menu');
    const sel  = document.getElementById('theme-select');
    if (!btn || !menu) return;

    // Populate if not server-rendered
    if (!menu.children.length) {
      themes.forEach(t => {
        const li = document.createElement('li');
        li.className = 'theme-picker-item';
        li.setAttribute('role', 'option');
        li.setAttribute('tabindex', '-1');
        li.dataset.theme = t;
        li.textContent = t;
        menu.appendChild(li);
        if (sel && !sel.querySelector(`option[value="${t}"]`)) {
          const opt = document.createElement('option');
          opt.value = t; opt.textContent = t;
          sel.appendChild(opt);
        }
      });
    }

    menu.addEventListener('click', e => {
      const item = e.target.closest('.theme-picker-item');
      if (!item) return;
      closePicker();
      setTheme(item.dataset.theme);
      btn.focus();
    });

    btn.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = !menu.hidden;
      menu.hidden = isOpen;
      btn.setAttribute('aria-expanded', String(!isOpen));
      if (!isOpen) {
        const active = menu.querySelector('.theme-picker-item.active');
        (active || menu.querySelector('.theme-picker-item'))?.focus();
      }
    });

    btn.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        menu.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        (menu.querySelector('.theme-picker-item.active') || menu.querySelector('.theme-picker-item'))?.focus();
      }
    });

    menu.addEventListener('keydown', e => {
      const items = [...menu.querySelectorAll('.theme-picker-item')];
      const idx   = items.indexOf(document.activeElement);
      if      (e.key === 'ArrowDown')  { e.preventDefault(); items[Math.min(idx + 1, items.length - 1)]?.focus(); }
      else if (e.key === 'ArrowUp')    { e.preventDefault(); if (idx <= 0) { closePicker(); btn.focus(); } else items[idx - 1]?.focus(); }
      else if (e.key === 'Enter')      { e.preventDefault(); if (document.activeElement.dataset?.theme) { closePicker(); setTheme(document.activeElement.dataset.theme); btn.focus(); } }
      else if (e.key === 'Escape')     { closePicker(); btn.focus(); }
    });

    document.addEventListener('click', closePicker);
    menu.addEventListener('click', e => e.stopPropagation());

    setTheme(currentTheme, false);
  }

  // ── Render mode toggle ────────────────────────────────────────────────────────

  function setRenderMode(auto) {
    autoRender = auto;
    localStorage.setItem(RENDER_MODE_KEY, auto ? 'auto' : 'manual');
    const toggle    = document.getElementById('render-toggle');
    const btnRender = document.getElementById('btn-render');
    if (!toggle) return;
    toggle.classList.toggle('is-manual', !auto);
    toggle.querySelector('.render-toggle-label').textContent = auto ? 'live' : 'manual';
    toggle.title = auto ? 'Live — click to switch to manual' : 'Manual — click to switch to live';
    if (btnRender) btnRender.hidden = auto;
  }

  document.getElementById('render-toggle')?.addEventListener('click', () => setRenderMode(!autoRender));
  document.getElementById('btn-render')?.addEventListener('click',    () => { clearTimeout(renderTimer); render(); });

  setRenderMode(autoRender);

  function scheduleRender() {
    if (!autoRender) return;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 240);
  }

  cm.on('change', scheduleRender);

  // Auto-trigger hint while typing keys/values — disabled on touch devices
  cm.on('inputRead', (editor, change) => {
    if (IS_TOUCH || hintWidget) return;
    const ch = change.text[0] || '';
    if (/[\w-]/.test(ch)) showSchemaHint(editor);
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

  // ── Mobile view switcher ─────────────────────────────────────────────────────

  function switchMobileView(view) {
    const editorPane  = document.querySelector('.editor-pane');
    const previewPane = document.querySelector('.preview-pane');
    editorPane?.classList.toggle('mobile-active',  view === 'editor');
    previewPane?.classList.toggle('mobile-active', view === 'preview');
    document.querySelectorAll('.mobile-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mobileView === view);
    });
    if (view === 'editor') setTimeout(() => cm.refresh(), 50);
  }

  document.querySelectorAll('.mobile-tab').forEach(btn => {
    btn.addEventListener('click', () => switchMobileView(btn.dataset.mobileView));
  });

  document.getElementById('btn-mobile-render')?.addEventListener('click', () => {
    clearTimeout(renderTimer);
    render().then(() => {
      if (isMobile()) switchMobileView('preview');
    });
  });

  // Init + respond to resize
  if (isMobile()) switchMobileView('editor');
  mq760.addEventListener('change', e => {
    if (!e.matches) {
      document.querySelector('.editor-pane')?.classList.remove('mobile-active');
      document.querySelector('.preview-pane')?.classList.remove('mobile-active');
    } else {
      switchMobileView('editor');
    }
  });

  // ── Print ─────────────────────────────────────────────────────────────────────

  // Print
  document.getElementById('btn-print')?.addEventListener('click', () => {
    try { document.getElementById('preview').contentWindow.print(); }
    catch (e) { status('print: ' + e.message, 'err'); }
  });

  // Download HTML (quick shortcut from top bar)
  document.getElementById('btn-download')?.addEventListener('click', async () => {
    const yaml  = cm.getValue();
    const theme = currentTheme || lastGoodTheme;
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
  function suggestName() {
    try {
      const r = jsyaml.load(cm.getValue()) || {};
      return (r.person && r.person.name) ? r.person.name + '\'s Resume' : 'My Resume';
    } catch { return 'My Resume'; }
  }

  function promptResumeName(defaultName) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'save-dialog-overlay';
      overlay.innerHTML = `
        <div class="save-dialog">
          <p class="save-dialog-title">Name this resume</p>
          <input id="save-dialog-input" class="save-dialog-input" type="text" value="${defaultName.replace(/"/g, '&quot;')}" autocomplete="off">
          <div class="save-dialog-actions">
            <button id="save-dialog-cancel" class="nav-ghost">Cancel</button>
            <button id="save-dialog-ok" class="nav-primary">Save</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const input  = overlay.querySelector('#save-dialog-input');
      const ok     = overlay.querySelector('#save-dialog-ok');
      const cancel = overlay.querySelector('#save-dialog-cancel');
      input.select();
      const finish = val => { overlay.remove(); resolve(val); };
      ok.addEventListener('click', () => { const v = input.value.trim(); if (v) finish(v); });
      cancel.addEventListener('click', () => finish(null));
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { const v = input.value.trim(); if (v) finish(v); }
        if (e.key === 'Escape') finish(null);
      });
    });
  }

  async function doSave(rename) {
    const yaml = cm.getValue();
    let name = currentResumeName;
    if (!name || rename) {
      name = await promptResumeName(currentResumeName || suggestName());
      if (!name) return;
    }
    try {
      const res = await fetch('/api/resumes', {
        method:  'POST',
        headers: {'Content-Type': 'application/json'},
        body:    JSON.stringify({ id: currentResumeId || undefined, name, yaml }),
      });
      if (!res.ok) throw new Error(await res.text());
      const saved = await res.json();
      currentResumeId   = saved.id;
      currentResumeName = saved.name;
      const label = document.getElementById('pane-file-label');
      if (label) label.textContent = saved.name;
      status('saved ✓', 'ok');
    } catch (e) { status('save: ' + e.message, 'err'); }
  }

  document.getElementById('btn-save')?.addEventListener('click', () => doSave(false));
  document.getElementById('btn-rename')?.addEventListener('click', () => doSave(true));

  // ── Keys help panel ──────────────────────────────────────────────────────────
  (function() {
    const btn   = document.getElementById('btn-keys');
    const panel = document.getElementById('keys-panel');
    if (!btn || !panel) return;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const open = !panel.hidden;
      panel.hidden = open;
      btn.setAttribute('aria-expanded', String(!open));
    });
    document.addEventListener('click', () => { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); });
    panel.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !panel.hidden) { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    });
  })();

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
    // Load themes (fetch if not server-rendered into <select>)
    const sel = document.getElementById('theme-select');
    let themes = sel ? [...sel.options].map(o => o.value).filter(Boolean) : [];
    if (!themes.length) {
      try {
        const r = await fetch('/api/themes');
        if (r.ok) themes = (await r.json()).themes || [];
      } catch { /* ignore */ }
    }
    initThemePicker(themes);

    // Restore saved theme
    const saved = localStorage.getItem(THEME_KEY);
    if (saved && themeExists(saved)) currentTheme = saved;
    else if (themes.length) currentTheme = themes[0];
    setTheme(currentTheme, false);

    // Load from saved resume if ?id= present (coming from dashboard)
    const urlId = new URLSearchParams(location.search).get('id');
    let yaml = null;
    if (urlId) {
      try {
        const res = await fetch('/api/resumes/' + urlId);
        if (res.ok) {
          const saved = await res.json();
          yaml = saved.yaml;
          currentResumeId   = saved.id;
          currentResumeName = saved.name;
          const label = document.getElementById('pane-file-label');
          if (label) label.textContent = saved.name;
        }
      } catch { /* fall through */ }
    }
    if (!yaml) yaml = await decodeShareYaml() || localStorage.getItem(STORAGE_KEY);
    if (!yaml) {
      try {
        const res = await fetch('/api/default-yaml');
        yaml = res.ok && res.status !== 204 ? await res.text() : DEFAULT_YAML;
      } catch { yaml = DEFAULT_YAML; }
    }
    cm.setValue(yaml);
    if (yamlHidden) yamlHidden.value = yaml;

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
