(function () {
  'use strict';

  const DEFAULT_YAML = `# yaml-language-server: $schema=https://resumelang.dev/schema/v1.json
resumelang: v1

# ── Meta ─────────────────────────────────────────────────────────────
meta:
  theme: sap        # sap | minimal | linear | vercel | brutalist | editorial
                        # academic | dossier | timeline
  language: en          # en | de | fr | es | pt | ja | zh ...
  page_size: a4         # a4 | letter
  # color: "#6366f1"    # accent color override (any hex)

  sections:             # remove or reorder to hide/reorder sections
    - summary
    - experience
    - education
    - skills
    - projects
    - certifications
    - languages
    - awards

  # ── Token overrides ──────────────────────────────────────────────
  # Override any theme design token. Merged on top of theme defaults.
  # tokens:
  #   colors:
  #     background:    "#ffffff"
  #     surface:       "#f5f5f8"
  #     surface_hover: "#ececf2"
  #     border:        "#e0e0ea"
  #     text_primary:  "#0a0a0f"
  #     text_secondary:"#5a5a78"
  #     text_tertiary: "#9090aa"
  #     accent:        "#6366f1"
  #   typography:
  #     heading_weight: 700
  #     body_size:      14
  #   spacing:
  #     section_gap:    28
  #     item_gap:       14
  #   radius:
  #     base:           8

# ── Person ───────────────────────────────────────────────────────────
person:
  name:     Jane Doe
  title:    Senior Software Engineer
  email:    jane@example.com
  phone:    "+1 555 000 0000"        # optional
  location: Stockholm, Sweden
  website:  https://janedoe.dev       # optional
  github:   janedoe                   # optional — username only
  linkedin: janedoe                   # optional — handle only
  # avatar: https://example.com/avatar.jpg  # optional — profile picture

# ── Summary ──────────────────────────────────────────────────────────
summary: |
  Experienced engineer with 8 years building distributed systems.
  Loves Go, Postgres, and small sharp tools. Passionate about
  developer experience and platform reliability.

# ── Experience ───────────────────────────────────────────────────────
experience:
  - company:  Acme Corp
    role:     Lead Engineer
    location: Stockholm
    start:    "2021"
    end:      ""              # blank = Present
    description: Led the platform team building internal developer tooling.
    highlights:
      - Scaled API to 10 M requests/day with zero downtime migration
      - Reduced CI deploy time by 60% via parallel pipeline redesign
      - Migrated monolith to event-driven architecture (Kafka)
    tags: [Go, Kubernetes, Postgres, Kafka]
    url: https://acme.com     # optional — company website

  - company:  Startup Inc
    role:     Senior Engineer
    location: Remote
    start:    "2018"
    end:      "2021"
    description: Built core billing and payments system from scratch.
    highlights:
      - Designed idempotent payment retry flow (99.99% success rate)
      - Authored open-source library adopted by 200+ companies
      - Mentored team of 4 engineers
    tags: [Python, Postgres, Stripe]

  - company:  Agency GmbH
    role:     Software Engineer
    location: Berlin
    start:    "2016"
    end:      "2018"
    description: Full-stack development for e-commerce clients.
    highlights:
      - Delivered 3 high-traffic storefronts (>50k DAU each)
      - Reduced page load time by 40% through caching strategy
    tags: [Node.js, React, Redis]

# ── Education ────────────────────────────────────────────────────────
education:
  - institution: KTH Royal Institute of Technology
    degree:      MSc
    field:       Computer Science
    start:       "2013"
    end:         "2015"
    gpa:         "4.0"             # optional
    # url: https://kth.se

  - institution: Uppsala University
    degree:      BSc
    field:       Mathematics
    start:       "2010"
    end:         "2013"

# ── Skills ───────────────────────────────────────────────────────────
skills:
  - category: Languages
    skills: [Go, TypeScript, Python, Rust, SQL]
  - category: Infrastructure
    skills: [Kubernetes, Terraform, AWS, GCP, Postgres]
  - category: Tools & Practices
    skills: [Git, Docker, Grafana, Prometheus, TDD]

# ── Projects ─────────────────────────────────────────────────────────
projects:
  - name:        gitshare
    description: P2P git repo sharing via bore.pub tunnels. Zero-dependency single binary.
    url:         https://github.com/janedoe/gitshare
    github:      janedoe/gitshare   # optional — enables star count display
    highlights:
      - Single static binary, no server required
      - Token-authenticated bore tunnel with E2E encryption
    tags: [Go, P2P, CLI]

  - name:        sqlmigrate
    description: Minimal SQL migration tool with rollback support.
    url:         https://github.com/janedoe/sqlmigrate
    highlights:
      - Supports Postgres, MySQL, SQLite
      - Embedded migrations from Go embed.FS
    tags: [Go, SQL, DevTools]

# ── Certifications ───────────────────────────────────────────────────
certifications:
  - name:   CKA — Certified Kubernetes Administrator
    issuer: CNCF
    date:   "2023"
    url:    https://cncf.io           # optional

  - name:   AWS Solutions Architect — Associate
    issuer: Amazon Web Services
    date:   "2022"

# ── Languages ────────────────────────────────────────────────────────
languages:
  - name: English
    proficiency: native               # native | fluent | professional | conversational | basic
  - name: Swedish
    proficiency: professional
  - name: German
    proficiency: conversational

# ── Awards ───────────────────────────────────────────────────────────
awards:
  - title:    Best Developer Tool — Nordic Tech Awards
    awarder:  Nordic Tech
    date:     "2023"
    # summary: Short description of the award

# ── Optional sections (uncomment to enable) ──────────────────────────
# publications:
#   - title:     "Designing for Resilience in Distributed Systems"
#     publisher: Engineering Blog
#     date:      "2022"
#     url:       https://example.com/post
#     # summary: Brief abstract or description

# volunteer:
#   - organization: Code.org
#     role:         Mentor
#     start:        "2020"
#     end:          ""

# custom:
#   - title: Open Source
#     items:
#       - name:        my-project
#         description: Short description of what it does
`;

  const STORAGE_KEY = 'resumelang.yaml';
  const THEME_KEY   = 'resumelang.theme';

  // Handlebars helpers
  Handlebars.registerHelper('join',    (a, s)     => Array.isArray(a) ? a.join(s) : '');
  Handlebars.registerHelper('eq',      (a, b)     => String(a) === String(b));
  Handlebars.registerHelper('default', (v, fb)    => (v === undefined || v === null || v === '') ? fb : v);
  Handlebars.registerHelper('upper',   (s)        => String(s || '').toUpperCase());
  Handlebars.registerHelper('lower',   (s)        => String(s || '').toLowerCase());

  // Status toast
  let statusTimer = null;
  const status = (msg, kind) => {
    const el = document.getElementById('status');
    el.textContent = msg;
    el.className = 'status-toast show' + (kind ? ' ' + kind : '');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => el.classList.remove('show'), kind === 'err' ? 6000 : 2400);
  };

  // Theme loader
  const themeCache = new Map();
  async function loadTheme(name) {
    if (themeCache.has(name)) return themeCache.get(name);
    const [tplRes, cssRes, ymlRes] = await Promise.all([
      fetch(`/themes/${name}/templates/resume.hbs`),
      fetch(`/themes/${name}/assets/style.css`),
      fetch(`/themes/${name}/theme.yml`),
    ]);
    if (!tplRes.ok) throw new Error(`template missing for "${name}"`);
    const tpl     = await tplRes.text();
    const css     = cssRes.ok ? await cssRes.text() : '';
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

  function applyEditorAppearance(themeYml) {
    const bg   = (themeYml && themeYml.tokens && themeYml.tokens.colors && themeYml.tokens.colors.background) || '#ffffff';
    const luma = hexLuma(bg);
    document.body.classList.toggle('cm-light', luma >= 0.5);
    cm.setOption('theme', luma < 0.5 ? 'material-darker' : 'default');
  }
  function hexLuma(hex) {
    const m = String(hex).trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return 1;
    let h = m[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const r = parseInt(h.slice(0,2),16)/255, g = parseInt(h.slice(2,4),16)/255, b = parseInt(h.slice(4,6),16)/255;
    return 0.2126*r + 0.7152*g + 0.0722*b;
  }

  // YAML syntax highlight for source view
  function syntaxHighlight(yaml) {
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return esc(yaml)
      .replace(/^(\s*)(#.*)$/gm, '$1<span class="hl-comment">$2</span>')
      .replace(/^(\s*)([\w\-.]+)(:)/gm, '$1<span class="hl-key">$2</span>$3')
      .replace(/(:\s*)("[^"]*"|'[^']*')/g, '$1<span class="hl-str">$2</span>');
  }

  // Render
  let lastHTML = '';
  function render() {
    const yamlText = cm.getValue();
    localStorage.setItem(STORAGE_KEY, yamlText);

    // Update YAML view if visible
    const yamlCode = document.getElementById('yaml-code');
    if (yamlCode) yamlCode.innerHTML = syntaxHighlight(yamlText);

    let resume;
    try {
      resume = jsyaml.load(yamlText) || {};
    } catch (e) {
      status('YAML parse error: ' + e.message, 'err');
      return;
    }

    const themeName = document.getElementById('theme-select').value || 'minimal';
    localStorage.setItem(THEME_KEY, themeName);

    loadTheme(themeName).then(({ compiled, css, themeYml }) => {
      const merged = mergeTokens(themeYml.tokens || {}, (resume.meta && resume.meta.tokens) || {});
      applyEditorAppearance({ tokens: merged });
      const tokens = flattenTokens(merged);
      const ctx = Object.assign({}, resume, { tokens, themeCSS: css });
      try {
        const html = compiled(ctx);
        lastHTML = html;
        document.getElementById('preview').srcdoc = html;
        status('rendered ' + new Date().toLocaleTimeString(), 'ok');
      } catch (e) {
        status('render error: ' + e.message, 'err');
      }
    }).catch(e => status('theme load: ' + e.message, 'err'));
  }

  let renderTimer = null;
  const scheduleRender = () => { clearTimeout(renderTimer); renderTimer = setTimeout(render, 240); };

  // CodeMirror init
  const cm = CodeMirror.fromTextArea(document.getElementById('editor'), {
    mode:        'yaml',
    lineNumbers: true,
    theme:       'material-darker',
    indentUnit:  2,
    tabSize:     2,
    lineWrapping: true,
    extraKeys:   { Tab: cm => cm.execCommand('insertSoftTab') },
  });
  cm.on('change', scheduleRender);

  // Preview / YAML tab toggle
  const tabs = document.querySelectorAll('.pane-tab');
  const viewPreview = document.getElementById('view-preview');
  const viewYaml    = document.getElementById('view-yaml');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const v = tab.dataset.view;
      viewPreview.hidden = (v !== 'preview');
      viewYaml.hidden    = (v !== 'yaml');
      if (v === 'yaml') {
        const yamlCode = document.getElementById('yaml-code');
        if (yamlCode) yamlCode.innerHTML = syntaxHighlight(cm.getValue());
      }
    });
  });

  // Theme dropdown
  fetch('/api/themes').then(r => r.json()).then(data => {
    const select = document.getElementById('theme-select');
    const themes = data.themes || ['minimal'];
    const saved  = localStorage.getItem(THEME_KEY);
    for (const t of themes) {
      const opt = document.createElement('option');
      opt.value = t; opt.textContent = t;
      if (t === saved) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', render);

    decodeShareYaml().then(shared => {
      cm.setValue(shared || localStorage.getItem(STORAGE_KEY) || DEFAULT_YAML);
      if (shared) status('loaded from share link', 'ok');
      render();
    });
  }).catch(e => status('themes: ' + e.message, 'err'));

  // Gallery
  const galleryModal  = document.getElementById('gallery-modal');
  const galleryGrid   = document.getElementById('gallery-grid');
  const gallerySearch = document.getElementById('gallery-search');
  const galleryCount  = document.getElementById('gallery-count');
  const galleryLoader = document.getElementById('gallery-loader');
  let galleryFilter = '', galleryItems = [];

  function renderThemeForGallery(name, yamlText) {
    return loadTheme(name).then(({ compiled, css, themeYml }) => {
      let resume; try { resume = jsyaml.load(yamlText) || {}; } catch { resume = {}; }
      const merged = mergeTokens(themeYml.tokens || {}, (resume.meta && resume.meta.tokens) || {});
      const tokens = flattenTokens(merged);
      return { name, html: compiled(Object.assign({}, resume, { tokens, themeCSS: css })), version: themeYml.version || '' };
    });
  }

  function renderGalleryGrid() {
    galleryGrid.innerHTML = '';
    const q = galleryFilter.trim().toLowerCase();
    const visible = galleryItems.filter(t => !q || t.name.toLowerCase().includes(q));
    galleryCount.textContent = `${visible.length} / ${galleryItems.length}`;
    const active = document.getElementById('theme-select').value;
    if (!visible.length) {
      const e = document.createElement('div'); e.className = 'gallery-empty';
      e.textContent = q ? `no themes match "${q}"` : 'no themes'; galleryGrid.appendChild(e); return;
    }
    for (const t of visible) {
      const card = document.createElement('div');
      card.className = 'gallery-card' + (t.name === active ? ' active' : '');
      const thumb = document.createElement('div'); thumb.className = 'gallery-thumb';
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox',''); iframe.setAttribute('referrerpolicy','no-referrer');
      iframe.setAttribute('loading','lazy'); iframe.srcdoc = t.html;
      const cover = document.createElement('div'); cover.className = 'gallery-thumb-cover';
      thumb.append(iframe, cover);
      const body = document.createElement('div'); body.className = 'gallery-card-body';
      const nm = document.createElement('span'); nm.className = 'gallery-card-name'; nm.textContent = t.name;
      const mt = document.createElement('span'); mt.className = 'gallery-card-meta'; mt.textContent = t.version ? 'v'+t.version : '';
      body.append(nm, mt); card.append(thumb, body);
      card.addEventListener('click', () => applyTheme(t.name));
      galleryGrid.appendChild(card);
    }
  }

  function applyTheme(name) {
    const sel = document.getElementById('theme-select');
    sel.value = name; sel.dispatchEvent(new Event('change')); closeGallery();
  }
  function openGallery() {
    galleryModal.hidden = false; galleryFilter = ''; gallerySearch.value = '';
    galleryGrid.innerHTML = ''; galleryLoader.hidden = false;
    setTimeout(() => gallerySearch.focus(), 30);
    const yamlText = cm.getValue();
    const themes   = Array.from(document.getElementById('theme-select').options).map(o => o.value);
    Promise.all(themes.map(n => renderThemeForGallery(n, yamlText).catch(() => null)))
      .then(results => { galleryItems = results.filter(Boolean); galleryLoader.hidden = true; renderGalleryGrid(); });
  }
  function closeGallery() { galleryModal.hidden = true; }

  document.getElementById('btn-gallery').addEventListener('click', openGallery);
  galleryModal.addEventListener('click', e => { if (e.target.dataset.close !== undefined) closeGallery(); });
  gallerySearch.addEventListener('input', e => { galleryFilter = e.target.value; renderGalleryGrid(); });
  document.addEventListener('keydown', e => {
    if (galleryModal.hidden) return;
    if (e.key === 'Escape') {
      if (gallerySearch.value) { gallerySearch.value = ''; galleryFilter = ''; renderGalleryGrid(); }
      else closeGallery();
    }
  });

  // Share (gzip + base64url → /r#yml=…)
  async function encodeShareYaml(text) {
    if (!('CompressionStream' in window)) return base64UrlEncode(new TextEncoder().encode(text));
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    return 'g.' + base64UrlEncode(new Uint8Array(buf));
  }
  async function decodeShareYaml() {
    const m = location.hash.match(/^#yml=(.+)$/);
    if (!m) return null;
    try {
      let raw = m[1];
      if (raw.startsWith('g.')) {
        const bytes = base64UrlDecode(raw.slice(2));
        if ('DecompressionStream' in window) {
          const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
          return await new Response(stream).text();
        }
        return null;
      }
      return new TextDecoder().decode(base64UrlDecode(raw));
    } catch (e) { status('share decode: ' + e.message, 'err'); return null; }
  }
  function base64UrlEncode(bytes) {
    let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function base64UrlDecode(str) {
    const b64 = (str + '='.repeat((4 - str.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/');
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return bytes;
  }

  document.getElementById('btn-share').addEventListener('click', async () => {
    try {
      const enc = await encodeShareYaml(cm.getValue());
      const url = location.origin + '/r#yml=' + enc;
      if (url.length > 8000) status('link is ' + url.length + ' chars — may break on some platforms', 'err');
      try { await navigator.clipboard.writeText(url); status('share link copied', 'ok'); }
      catch { prompt('Copy this link:', url); }
    } catch (e) { status('share: ' + e.message, 'err'); }
  });

  // User widget
  fetch('/api/me', { credentials: 'same-origin' }).then(r => r.json()).then(data => {
    const widget = document.getElementById('user-widget');
    const chip   = document.getElementById('user-link');
    const signin = document.getElementById('user-signin');
    widget.hidden = false;
    if (data && data.user) {
      const u = data.user;
      document.getElementById('user-avatar').src = u.avatar || '/web/favicon.svg';
      document.getElementById('user-name').textContent = u.name || u.login || u.provider;
      chip.style.display = ''; chip.href = '/auth/logout'; signin.style.display = 'none';
    } else {
      chip.style.display = 'none'; signin.style.display = '';
      if (!data || !Array.isArray(data.providers) || !data.providers.length) signin.style.display = 'none';
    }
  }).catch(() => {});

  // Print
  document.getElementById('btn-print').addEventListener('click', () => {
    const iframe = document.getElementById('preview');
    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (e) { status('print: ' + e.message, 'err'); }
  });

  // Download HTML
  document.getElementById('btn-download').addEventListener('click', () => {
    if (!lastHTML) return;
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([lastHTML], { type: 'text/html' })),
      download: 'resume.html',
    });
    a.click(); URL.revokeObjectURL(a.href);
  });

  // Splitter drag
  (function () {
    const splitter = document.getElementById('splitter');
    const workspace = document.getElementById('split');
    const SPLIT_KEY = 'resumelang.split';
    const saved = localStorage.getItem(SPLIT_KEY);
    if (saved) workspace.style.setProperty('--pane-split', saved);
    let dragging = false, isVert = false;
    splitter.addEventListener('pointerdown', e => {
      dragging = true; isVert = window.matchMedia('(max-width: 760px)').matches;
      splitter.classList.add('dragging'); document.body.classList.add('dragging');
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
      if (!dragging) return; dragging = false;
      splitter.classList.remove('dragging'); document.body.classList.remove('dragging');
      splitter.releasePointerCapture(e.pointerId);
      localStorage.setItem(SPLIT_KEY, workspace.style.getPropertyValue('--pane-split') || '50%');
    });
  })();
})();
