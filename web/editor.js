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

  // Handlebars helpers (mirrors view.js)
  Handlebars.registerHelper('join',    (a, s) => Array.isArray(a) ? a.join(s) : '');
  Handlebars.registerHelper('eq',      (a, b) => String(a) === String(b));
  Handlebars.registerHelper('default', (v, fb) => (v === undefined || v === null || v === '') ? fb : v);
  Handlebars.registerHelper('upper',   s => String(s || '').toUpperCase());
  Handlebars.registerHelper('lower',   s => String(s || '').toLowerCase());

  // ── Preview ↔ Editor bridge ──────────────────────────────────────────────────

  const RL_SECTIONS = ['experience','education','skills','projects','certifications',
                       'languages','awards','publications','volunteer','custom'];

  // Inject _rl_id into every array item before passing to Handlebars
  function injectRlIds(resume) {
    const out = Object.assign({}, resume);
    for (const s of RL_SECTIONS) {
      if (Array.isArray(out[s])) {
        out[s] = out[s].map((item, i) => Object.assign({}, item, { _rl_id: s + '-' + i }));
      }
    }
    return out;
  }

  // Script injected into every iframe — forwards clicks up and handles highlights
  const BRIDGE_SCRIPT = `<script>(function(){
  document.addEventListener('click',function(e){
    var el=e.target.closest('[data-rl-id]');
    if(!el)return;
    parent.postMessage({type:'rl-click',id:el.dataset.rlId},'*');
  });
  window.addEventListener('message',function(e){
    if(!e.data||e.data.type!=='rl-highlight')return;
    var prev=document.querySelector('.rl-active');
    if(prev)prev.classList.remove('rl-active');
    if(!e.data.id)return;
    var el=document.getElementById(e.data.id);
    if(el){el.classList.add('rl-active');el.scrollIntoView({behavior:'smooth',block:'nearest'});}
  });
})()\x3c/script>
<style>.rl-active{outline:2px solid #6366f1!important;outline-offset:3px;border-radius:3px;}</style>`;

  // Given a section name + 0-based index, find the line in YAML and move cursor there
  function jumpToYamlItem(section, idx) {
    const lines = cm.getValue().split('\n');
    let inSection = false;
    let itemCount = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const topKey = line.match(/^([a-zA-Z_]+)\s*:/)?.[1];
      if (topKey) {
        inSection = topKey === section;
        if (inSection) itemCount = -1;
        else continue;
      }
      if (inSection && /^\s{0,6}-\s/.test(line) && !/^\s{8,}/.test(line)) {
        itemCount++;
        if (itemCount === idx) {
          cm.setCursor({ line: i, ch: 0 });
          cm.scrollIntoView({ line: i, ch: 0 }, 80);
          cm.focus();
          return;
        }
      }
    }
  }

  // From current cursor position, find which section+index we're inside
  function getYamlItemAtCursor() {
    const cursor = cm.getCursor();
    const lines  = cm.getValue().split('\n');
    const SSET   = new Set(RL_SECTIONS);
    let curSection = null;
    let curIndex   = -1;
    for (let i = 0; i <= cursor.line; i++) {
      const line = lines[i];
      const topKey = line.match(/^([a-zA-Z_]+)\s*:/)?.[1];
      if (topKey) {
        if (SSET.has(topKey)) { curSection = topKey; curIndex = -1; }
        else curSection = null;
        continue;
      }
      if (curSection && /^\s{0,6}-\s/.test(line) && !/^\s{8,}/.test(line)) {
        curIndex++;
      }
    }
    if (curSection && curIndex >= 0) return { section: curSection, index: curIndex };
    return null;
  }

  // Listen for click events forwarded from the iframe
  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== 'rl-click') return;
    const parts = e.data.id.split('-');
    const idx   = parseInt(parts.pop(), 10);
    const section = parts.join('-');
    jumpToYamlItem(section, idx);
  });

  // ── Client-side theme loading ────────────────────────────────────────────────

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
      const v   = tokens[k];
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
    if (!tplRes.ok) throw new Error(`template missing for theme "${name}"`);
    const tpl     = await tplRes.text();
    const css     = cssRes.ok ? await cssRes.text() : '';
    const ymlText = ymlRes.ok  ? await ymlRes.text() : '';
    const themeYml = ymlText ? jsyaml.load(ymlText) || {} : {};
    const data = { compiled: Handlebars.compile(tpl), css, themeYml };
    themeCache.set(name, data);
    return data;
  }

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
    foldGutter:   true,
    gutters:      ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
    foldOptions:  { rangeFinder: CodeMirror.fold.indent },
    extraKeys: {
      Tab:           c => c.execCommand('insertSoftTab'),
      'Ctrl-Space':  c => showSchemaHint(c),
      'Ctrl-Enter':  () => { clearTimeout(renderTimer); render(); },
      'Ctrl-/':      c => toggleComment(c),
      'Cmd-/':       c => toggleComment(c),
      'Ctrl-Q':      c => c.foldCode(c.getCursor()),
      'Cmd-Q':       c => c.foldCode(c.getCursor()),
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
      const { compiled, css, themeYml } = await loadTheme(theme);
      const enriched = injectRlIds(resume);
      const merged   = mergeTokens(themeYml.tokens || {}, (enriched.meta && enriched.meta.tokens) || {});
      const tokens   = flattenTokens(merged);
      const html     = compiled(Object.assign({}, enriched, { tokens, themeCSS: css }));
      document.getElementById('preview').srcdoc = html.replace('</body>', BRIDGE_SCRIPT + '</body>');
      lastGoodTheme = theme;
      setTheme(theme, false);
    } catch (e) {
      status('render: ' + e.message, 'err');
      if (theme !== lastGoodTheme) {
        reRenderWithTheme(yaml, lastGoodTheme);
      }
    }
  }

  async function reRenderWithTheme(yaml, theme) {
    try {
      let resume = {};
      try { resume = jsyaml.load(yaml) || {}; } catch { /* ignore */ }
      const { compiled, css, themeYml } = await loadTheme(theme);
      const enriched = injectRlIds(resume);
      const tokens   = flattenTokens(mergeTokens(themeYml.tokens || {}, {}));
      const html     = compiled(Object.assign({}, enriched, { tokens, themeCSS: css }));
      document.getElementById('preview').srcdoc = html.replace('</body>', BRIDGE_SCRIPT + '</body>');
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

  // Cursor in editor → highlight corresponding preview element
  let hlTimer;
  cm.on('cursorActivity', function() {
    clearTimeout(hlTimer);
    hlTimer = setTimeout(function() {
      const pos = getYamlItemAtCursor();
      if (!pos) return;
      const iframe = document.getElementById('preview');
      iframe.contentWindow?.postMessage({ type: 'rl-highlight', id: pos.section + '-' + pos.index }, '*');
    }, 120);
  });

  // Update editor info (lines/chars)
  cm.on('change', () => {
    const info = document.getElementById('editor-info');
    if (!info) return;
    const content = cm.getValue();
    const lines = content.split('\n').length;
    const chars = content.length;
    info.textContent = lines + ' lines · ' + chars + ' chars';
  });
  // Initial update
  setTimeout(() => {
    const info = document.getElementById('editor-info');
    if (!info) return;
    const content = cm.getValue();
    const lines = content.split('\n').length;
    const chars = content.length;
    info.textContent = lines + ' lines · ' + chars + ' chars';
  }, 100);

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

  // Download split button
  const dlSplit   = document.getElementById('dl-split');
  const dlMenu    = document.getElementById('dl-menu');
  const dlToggle  = document.getElementById('btn-download-toggle');

  const fmtMeta = {
    html: { endpoint: '/api/export/html', ext: 'html', mime: 'text/html' },
    txt:  { endpoint: '/api/export/txt',  ext: 'txt',  mime: 'text/plain' },
  };

  function printPDF() {
    try { document.getElementById('preview').contentWindow.print(); }
    catch (e) { status('print: ' + e.message, 'err'); }
  }

  async function doDownload(fmt) {
    if (fmt === 'pdf') { printPDF(); return; }
    const meta  = fmtMeta[fmt];
    const yaml  = cm.getValue();
    const theme = currentTheme || lastGoodTheme;
    status(`generating ${fmt.toUpperCase()}…`);
    try {
      const res = await fetch(meta.endpoint, {
        method:  'POST',
        headers: {'Content-Type': 'application/json'},
        body:    JSON.stringify({yaml, theme}),
      });
      if (!res.ok) { status(await res.text(), 'err'); return; }
      const blob = await res.blob();
      const cd   = res.headers.get('Content-Disposition') || '';
      const m    = cd.match(/filename="([^"]+)"/);
      const name = m ? m[1] : `resume.${meta.ext}`;
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob), download: name,
      });
      a.click(); URL.revokeObjectURL(a.href);
      status(`downloaded ${name}`);
    } catch (e) { status('download: ' + e.message, 'err'); }
  }

  document.getElementById('btn-print')?.addEventListener('click', printPDF);
  document.getElementById('btn-download')?.addEventListener('click', () => doDownload('pdf'));

  dlToggle?.addEventListener('click', e => {
    e.stopPropagation();
    const open = !dlMenu.hidden;
    dlMenu.hidden = open;
    dlToggle.setAttribute('aria-expanded', String(!open));
  });

  dlMenu?.addEventListener('click', e => {
    const item = e.target.closest('.dl-menu-item');
    if (!item) return;
    dlMenu.hidden = true;
    dlToggle.setAttribute('aria-expanded', 'false');
    const fmt = item.dataset.fmt;
    if (fmt === 'print') { printPDF(); return; }
    doDownload(fmt);
  });

  document.addEventListener('click', e => {
    if (dlSplit && !dlSplit.contains(e.target)) {
      dlMenu.hidden = true;
      dlToggle?.setAttribute('aria-expanded', 'false');
    }
  });

  // ── LocalStorage resume list (for unlogged users) ──────────────────────

  const LOCAL_RESUMES_KEY = 'resumelang.local_resumes';

  function getLocalResumes() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_RESUMES_KEY)) || [];
    } catch { return []; }
  }

  function setLocalResumes(list) {
    localStorage.setItem(LOCAL_RESUMES_KEY, JSON.stringify(list));
  }

  function addLocalResume(name, yaml) {
    const list = getLocalResumes();
    const id   = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    list.push({ id, name, yaml, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    setLocalResumes(list);
    return id;
  }

  function updateLocalResume(id, name, yaml) {
    const list = getLocalResumes();
    const idx  = list.findIndex(r => r.id === id);
    if (idx >= 0) {
      list[idx].name      = name;
      list[idx].yaml      = yaml;
      list[idx].updatedAt = new Date().toISOString();
      setLocalResumes(list);
    }
  }

  function deleteLocalResume(id) {
    setLocalResumes(getLocalResumes().filter(r => r.id !== id));
  }

  // ── Save (logged-in users → server, unlogged → localStorage) ─────────

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
          <input id="save-dialog-input" class="save-dialog-input" type="text" value="${defaultName.replace(/"/g, '&quot;')}">
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
    const isLoggedIn = !!(document.querySelector('.user-menu'));
    let name = currentResumeName;
    if (!name || rename) {
      name = await promptResumeName(currentResumeName || suggestName());
      if (!name) return;
    }
    if (!isLoggedIn) {
      // Save to localStorage
      if (currentResumeId) {
        updateLocalResume(currentResumeId, name, yaml);
        status('saved locally ✓', 'ok');
      } else {
        currentResumeId   = addLocalResume(name, yaml);
        currentResumeName = name;
        status('saved locally ✓', 'ok');
      }
      const label = document.getElementById('pane-file-label');
      if (label) label.textContent = name;
      // Refresh local drafts menu if visible
      const draftLabel = document.getElementById('local-draft-label');
      if (draftLabel) draftLabel.textContent = name;
      const menu = document.getElementById('local-drafts-menu');
      if (menu) {
        menu.querySelectorAll('.theme-picker-item').forEach(el => {
          el.classList.toggle('active', el.dataset.id === currentResumeId);
        });
      }
      return;
    }
    // Logged-in → save to server
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

  // Show Save button always (not just when logged in)
  (function initSaveButton() {
    const saveBtn   = document.getElementById('btn-save');
    const renameBtn = document.getElementById('btn-rename');
    const isLoggedIn = !!document.querySelector('.user-menu');
    if (!saveBtn) return;
    saveBtn.style.display = isLoggedIn ? '' : 'none';
    renameBtn.style.display = isLoggedIn ? '' : 'none';
    saveBtn.addEventListener('click', () => doSave(false));
    renameBtn?.addEventListener('click', () => doSave(true));

    // Local drafts UI for unlogged users
    const cluster = document.getElementById('local-drafts-cluster');
    if (isLoggedIn || !cluster) return;
    cluster.hidden = false;

    const newDraftBtn  = document.getElementById('btn-new-draft');
    const draftsBtn    = document.getElementById('local-drafts-btn');
    const draftsMenu   = document.getElementById('local-drafts-menu');
    const draftLabel   = document.getElementById('local-draft-label');

    function refreshDraftsMenu() {
      if (!draftsMenu) return;
      const resumes = getLocalResumes();
      draftsMenu.innerHTML = '';
      resumes.forEach(r => {
        const li = document.createElement('li');
        li.className = 'theme-picker-item' + (r.id === currentResumeId ? ' active' : '');
        li.role = 'option';
        li.textContent = r.name || 'Untitled';
        li.tabIndex = -1;
        li.dataset.id = r.id;
        li.addEventListener('click', () => loadLocalDraft(r.id));
        draftsMenu.appendChild(li);
      });
      if (draftsBtn) draftsBtn.setAttribute('aria-expanded', 'false');
    }

    window.loadLocalDraft = function(id) {
      if (typeof window.importLocalResume === 'undefined') {
        window.importLocalResume = importLocalResume;
      }
      const r = getLocalResumes().find(x => x.id === id);
      if (!r) return;
      cm.setValue(r.yaml);
      currentResumeId   = r.id;
      currentResumeName = r.name;
      const label = document.getElementById('pane-file-label');
      if (label) label.textContent = r.name;
      draftsMenu?.querySelectorAll('.theme-picker-item').forEach(el => {
        el.classList.toggle('active', el.dataset.id === id);
      });
    };

    newDraftBtn?.addEventListener('click', async () => {
      const yaml = cm.getValue();
      const name = await promptResumeName(suggestName());
      if (!name) return;
      currentResumeId   = addLocalResume(name, yaml);
      currentResumeName = name;
      const label = document.getElementById('pane-file-label');
      if (label) label.textContent = name;
      refreshDraftsMenu();
      status('new draft saved ✓', 'ok');
    });

    draftsBtn?.addEventListener('click', e => {
      e.stopPropagation();
      const open = draftsMenu.hidden;
      refreshDraftsMenu();
      draftsMenu.hidden = !open;
      draftsBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', () => {
      if (draftsMenu) { draftsMenu.hidden = true; draftsBtn?.setAttribute('aria-expanded', 'false'); }
    });
    draftsMenu?.addEventListener('click', e => e.stopPropagation());

    // Show current draft name if any
    if (currentResumeId && draftLabel) {
      const r = getLocalResumes().find(x => x.id === currentResumeId);
      if (r) draftLabel.textContent = r.name || 'Untitled';
    }
    refreshDraftsMenu();
  })();

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

  function setEditorYAML(yaml, label) {
    cm.setValue(yaml);
    if (yamlHidden) yamlHidden.value = yaml;
    localStorage.setItem(STORAGE_KEY, yaml);
    currentResumeId = null;
    currentResumeName = null;
    const fileLabel = document.getElementById('pane-file-label');
    if (fileLabel) fileLabel.textContent = label || 'resume.yml';
    clearTimeout(renderTimer);
    render();
  }

  function hideStartImport() {
    const overlay = document.getElementById('start-import');
    if (overlay) overlay.hidden = true;
  }

  async function loadSampleYAML() {
    try {
      const res = await fetch('/api/default-yaml');
      const yaml = res.ok && res.status !== 204 ? await res.text() : DEFAULT_YAML;
      setEditorYAML(yaml, 'sample.resume.yml');
      hideStartImport();
      status('sample YAML loaded', 'ok');
    } catch (e) {
      setEditorYAML(DEFAULT_YAML, 'sample.resume.yml');
      hideStartImport();
      status('sample YAML loaded', 'ok');
    }
  }

  async function importFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    status('importing ' + file.name + '...');
    try {
      const res = await fetch('/api/import', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setEditorYAML(data.yaml, file.name.replace(/\.(pdf|docx|md|markdown|ya?ml)$/i, '.yml'));
      hideStartImport();
      status('imported ' + file.name, 'ok');
    } catch (err) {
      status('import: ' + err.message, 'err');
    } finally {
      input.value = '';
    }
  }

  (function initImportUI() {
    const fileInput = document.getElementById('import-file');
    fileInput?.addEventListener('change', () => importFile(fileInput));
    document.getElementById('start-import-file')?.addEventListener('click', () => fileInput?.click());
    document.getElementById('start-sample-yaml')?.addEventListener('click', loadSampleYAML);
    document.getElementById('start-blank-yaml')?.addEventListener('click', hideStartImport);
  })();

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
    const hasSharedYAML = /^#yml=/.test(location.hash);
    const hasLocalYAML = !!localStorage.getItem(STORAGE_KEY);
    const shouldShowStartImport = !urlId && !hasSharedYAML && !hasLocalYAML;
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

    if (shouldShowStartImport) {
      const overlay = document.getElementById('start-import');
      if (overlay) overlay.hidden = false;
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

  // ── ATS Overlay ────────────────────────────────────────────────
  (function () {
    const overlay      = document.getElementById('ats-overlay');
    const closeBtn     = document.getElementById('ats-close');
    const analyzeBtn   = document.getElementById('ats-analyze');
    const scorePill    = document.getElementById('ats-score-pill');
    const pillNum      = document.getElementById('ats-pill-num');
    const jdArea       = document.getElementById('ats-jd');
    const loading      = document.getElementById('ats-loading');
    const errorBox     = document.getElementById('ats-error');
    const results      = document.getElementById('ats-results');
    const scoreNum     = document.getElementById('ats-score-num');
    const scoreTag     = document.getElementById('ats-score-tag');
    const modeBadge    = document.getElementById('ats-mode-badge');
    const ringFill     = document.getElementById('ats-ring-fill');
    const missing      = document.getElementById('ats-missing');
    const weakList     = document.getElementById('ats-weak');
    const strengths    = document.getElementById('ats-strengths');
    const tipBox       = document.getElementById('ats-tip');

    function openATS() {
      overlay.hidden = false;
      document.body.style.overflow = 'hidden';
    }
    function closeATS() {
      overlay.hidden = true;
      document.body.style.overflow = '';
    }

    scorePill.addEventListener('click', openATS);
    const mobileBtn = document.getElementById('btn-ats-mobile');
    if (mobileBtn) mobileBtn.addEventListener('click', openATS);
    closeBtn.addEventListener('click', closeATS);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeATS(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !overlay.hidden) closeATS(); });

    function setScore(score) {
      const circumference = 251.2;
      const offset = circumference - (score / 100) * circumference;
      ringFill.style.strokeDashoffset = offset;
      let color, label;
      if (score >= 90)      { color = '#22c55e'; label = 'Excellent'; }
      else if (score >= 75) { color = '#4ade80'; label = 'Strong'; }
      else if (score >= 60) { color = '#f59e0b'; label = 'Competitive'; }
      else if (score >= 40) { color = '#fb923c'; label = 'Developing'; }
      else                  { color = '#f87171'; label = 'Needs Work'; }
      ringFill.style.stroke = color;
      scoreNum.textContent = score;
      scoreTag.textContent = label;
      scoreTag.style.color = color;
    }

    function renderMissing(keywords) {
      missing.innerHTML = '';
      if (!keywords || !keywords.length) {
        missing.innerHTML = '<span style="font-size:12px;color:var(--text-muted,#888)">None found — great coverage!</span>';
        return;
      }
      keywords.forEach(kw => {
        const pill = document.createElement('button');
        pill.className = 'ats-pill';
        pill.textContent = kw;
        pill.title = 'Click to copy';
        pill.addEventListener('click', () => {
          navigator.clipboard.writeText(kw).catch(() => {});
          pill.classList.add('ats-pill-copied');
          pill.textContent = '✓ ' + kw;
          setTimeout(() => { pill.classList.remove('ats-pill-copied'); pill.textContent = kw; }, 1500);
        });
        missing.appendChild(pill);
      });
    }

    function renderWeak(bullets) {
      weakList.innerHTML = '';
      if (!bullets || !bullets.length) {
        weakList.innerHTML = '<span style="font-size:12px;color:var(--text-muted,#888)">No weak bullets found — nice work!</span>';
        return;
      }
      bullets.forEach(b => {
        const item = document.createElement('div');
        item.className = 'ats-weak-item';
        item.innerHTML =
          `<div class="ats-weak-orig"><span>⚠</span><span>${esc(b.original)}</span></div>` +
          `<div class="ats-weak-arrow">→</div>` +
          `<div class="ats-weak-sug">${esc(b.suggestion)}</div>`;
        weakList.appendChild(item);
      });
    }

    function renderStrengths(list) {
      strengths.innerHTML = '';
      (list || []).forEach(s => {
        const row = document.createElement('div');
        row.className = 'ats-strength';
        row.innerHTML = `<span class="ats-strength-icon">✓</span><span>${esc(s)}</span>`;
        strengths.appendChild(row);
      });
    }

    function esc(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function scoreColor(s) {
      if (s >= 75) return '#4ade80';
      if (s >= 60) return '#fbbf24';
      if (s >= 40) return '#fb923c';
      return '#f87171';
    }

    function updatePill(score) {
      const color = scoreColor(score);
      pillNum.textContent = score;
      // match render-toggle pattern: tinted bg + border + text all from same color
      scorePill.style.background = `rgba(${hexToRgb(color)},.1)`;
      scorePill.style.borderColor = `rgba(${hexToRgb(color)},.22)`;
      scorePill.style.color = color;
    }

    function hexToRgb(hex) {
      const r = parseInt(hex.slice(1,3),16);
      const g = parseInt(hex.slice(3,5),16);
      const b = parseInt(hex.slice(5,7),16);
      return `${r},${g},${b}`;
    }

    async function runAnalysis() {
      const yaml = window.editorGetYAML ? window.editorGetYAML() : '';
      if (!yaml) return;

      loading.hidden = false;
      errorBox.hidden = true;
      results.hidden = true;
      analyzeBtn.disabled = true;

      try {
        const res = await fetch('/api/ats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ yaml, job_description: jdArea.value.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Analysis failed');

        setScore(data.score || 0);
        renderMissing(data.missing_keywords);
        renderWeak(data.weak_bullets);
        renderStrengths(data.strengths);
        if (data.tip) { tipBox.textContent = data.tip; tipBox.hidden = false; }
        else { tipBox.hidden = true; }
        modeBadge.className = 'ats-mode-badge ' + (data.offline ? 'offline' : 'ai');
        modeBadge.innerHTML = data.offline
          ? '◦ Basic check'
          : '<svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M7 1l1.5 4H13l-3.5 2.5 1.5 4L7 9 3 11.5l1.5-4L1 5h4.5z"/></svg> Grok AI';
        modeBadge.hidden = false;
        results.hidden = false;
        updatePill(data.score || 0);
      } catch (err) {
        errorBox.textContent = 'Error: ' + err.message;
        errorBox.hidden = false;
      } finally {
        loading.hidden = true;
        analyzeBtn.disabled = false;
      }
    }

    analyzeBtn.addEventListener('click', runAnalysis);
  })();

  // ── Visibility control (nav badge) ────────────────────────────────
  (function() {
    const ctrl    = document.getElementById('vis-ctrl');
    const btn     = document.getElementById('vis-btn');
    const popover = document.getElementById('vis-popover');
    const label   = document.getElementById('vis-label');
    const pwWrap  = document.getElementById('vis-pw-wrap');
    const pwInput = document.getElementById('vis-pw');
    const saveBtn = document.getElementById('vis-save-btn');
    if (!ctrl || !btn || !popover) return;

    const LABELS = { private: 'Private', public: 'Public', password: 'Password' };

    function closePopover() {
      popover.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.addEventListener('click', e => {
      e.stopPropagation();
      const open = !popover.hidden;
      popover.hidden = open;
      btn.setAttribute('aria-expanded', String(!open));
    });

    document.addEventListener('click', closePopover);
    popover.addEventListener('click', e => e.stopPropagation());

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !popover.hidden) closePopover();
    });

    let pendingVis = btn.className.replace(/.*vis-btn-/, '').trim() || 'private';

    popover.querySelectorAll('.vis-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        popover.querySelectorAll('.vis-opt').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        pendingVis = opt.dataset.vis;
        if (pwWrap) pwWrap.hidden = (pendingVis !== 'password');
        if (pendingVis === 'password' && pwInput) pwInput.focus();
      });
    });

    async function saveVisibility() {
      const resumeId = ctrl.dataset.resumeId;
      if (!resumeId) return;
      const pw = (pendingVis === 'password' && pwInput) ? pwInput.value.trim() : '';
      if (pendingVis === 'password' && !pw) { if (pwInput) pwInput.focus(); return; }

      saveBtn.disabled = true;
      saveBtn.textContent = '…';
      try {
        const res = await fetch('/api/resumes/' + resumeId, {
          method: 'PATCH',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ visibility: pendingVis, password: pw })
        });
        if (!res.ok) throw new Error(await res.text());
        // Update badge
        btn.className = 'vis-btn vis-btn-' + pendingVis;
        label.textContent = LABELS[pendingVis] || pendingVis;
        if (pwInput) pwInput.value = '';
        closePopover();
      } catch (e) {
        saveBtn.textContent = 'Error';
        setTimeout(() => { saveBtn.textContent = 'Save'; saveBtn.disabled = false; }, 1500);
        return;
      }
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }

    saveBtn.addEventListener('click', saveVisibility);

    // Sync when share modal changes visibility
    document.addEventListener('rl-vis-changed', e => {
      const vis = e.detail && e.detail.vis;
      if (!vis) return;
      pendingVis = vis;
      btn.className = 'vis-btn vis-btn-' + vis;
      label.textContent = LABELS[vis] || vis;
      popover.querySelectorAll('.vis-opt').forEach(o => {
        o.classList.toggle('active', o.dataset.vis === vis);
      });
    });
  })();
})();
