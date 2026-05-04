(function () {
  'use strict';

  Handlebars.registerHelper('join',    (a, s) => Array.isArray(a) ? a.join(s) : '');
  Handlebars.registerHelper('eq',      (a, b) => String(a) === String(b));
  Handlebars.registerHelper('default', (v, fb) => (v === undefined || v === null || v === '') ? fb : v);
  Handlebars.registerHelper('upper',   s => String(s || '').toUpperCase());
  Handlebars.registerHelper('lower',   s => String(s || '').toLowerCase());

  const $ = id => document.getElementById(id);

  function showError(msg) {
    const el = $('view-error');
    if (el) { el.textContent = msg; el.hidden = false; }
  }

  // ── Base64url helpers ──────────────────────────────────────────

  function b64urlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ── Decoding ───────────────────────────────────────────────────

  async function fetchPublicWithPassword(shareId) {
    const overlay = $('pw-overlay');
    const input   = $('pw-input');
    const submit  = $('pw-submit');
    const errMsg  = $('pw-error');
    overlay.hidden = false;
    input.focus();
    return new Promise(resolve => {
      async function attempt() {
        const pw = input.value.trim();
        if (!pw) { input.focus(); return; }
        submit.disabled = true;
        submit.textContent = '…';
        errMsg.hidden = true;
        try {
          const res = await fetch('/api/public/' + shareId + '?pw=' + encodeURIComponent(pw));
          if (res.status === 403) {
            errMsg.hidden = false;
            input.value = '';
            input.focus();
            submit.disabled = false;
            submit.textContent = 'Unlock';
            return;
          }
          if (!res.ok) throw new Error('server error');
          const data = await res.json();
          overlay.hidden = true;
          resolve(data.yaml);
        } catch {
          errMsg.hidden = false;
          input.value = '';
          input.focus();
          submit.disabled = false;
          submit.textContent = 'Unlock';
        }
      }
      submit.addEventListener('click', attempt);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
    });
  }

  async function decodeShareYaml() {
    // Short link for server-saved resumes
    const idMatch = location.hash.match(/^#id=(.+)$/);
    if (idMatch) {
      const res = await fetch('/api/public/' + idMatch[1]);
      if (res.status === 401) return fetchPublicWithPassword(idMatch[1]);
      if (res.status === 403) throw new Error('This resume is private.');
      if (!res.ok) throw new Error('resume not found');
      const data = await res.json();
      return data.yaml;
    }

    const m = location.hash.match(/^#yml=(.+)$/);
    if (!m) return null;
    const raw = m[1];

    // Gzip compressed (g.)
    if (raw.startsWith('g.')) {
      const bytes = b64urlDecode(raw.slice(2));
      if (!('DecompressionStream' in window)) throw new Error('browser lacks DecompressionStream');
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new TextDecoder().decode(await new Response(stream).arrayBuffer());
    }

    // Password encrypted (p.)
    if (raw.startsWith('p.')) {
      return decryptWithPrompt(raw);
    }

    // Plain base64url
    return new TextDecoder().decode(b64urlDecode(raw));
  }

  async function decryptWithPrompt(encoded) {
    const overlay = $('pw-overlay');
    const input   = $('pw-input');
    const submit  = $('pw-submit');
    const errMsg  = $('pw-error');
    overlay.hidden = false;
    input.focus();

    return new Promise(resolve => {
      async function attempt() {
        const pw = input.value.trim();
        if (!pw) { input.focus(); return; }
        submit.disabled = true;
        submit.textContent = '…';
        errMsg.hidden = true;
        try {
          const yaml = await decryptYaml(encoded, pw);
          overlay.hidden = true;
          resolve(yaml);
        } catch {
          errMsg.hidden = false;
          input.value = '';
          input.focus();
          submit.disabled = false;
          submit.textContent = 'Unlock';
        }
      }
      submit.addEventListener('click', attempt);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
    });
  }

  async function decryptYaml(encoded, password) {
    // Format: p.<salt16>.<iv12>.<ciphertext>
    const parts = encoded.split('.');
    if (parts.length !== 4 || parts[0] !== 'p') throw new Error('bad format');
    const salt       = b64urlDecode(parts[1]);
    const iv         = b64urlDecode(parts[2]);
    const ciphertext = b64urlDecode(parts[3]);
    const enc = new TextEncoder();
    const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      {name:'PBKDF2', salt, iterations:100000, hash:'SHA-256'},
      km, {name:'AES-GCM', length:256}, false, ['decrypt']
    );
    const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, ciphertext);
    return new TextDecoder().decode(plain);
  }

  // ── Theme rendering (client-side Handlebars) ───────────────────

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

  const themeCache = new Map();
  async function loadTheme(name) {
    if (themeCache.has(name)) return themeCache.get(name);
    const [tplRes, cssRes, ymlRes] = await Promise.all([
      fetch(`/themes/${name}/templates/resume.hbs`),
      fetch(`/themes/${name}/assets/style.css`),
      fetch(`/themes/${name}/theme.yml`),
    ]);
    if (!tplRes.ok) throw new Error(`template missing for ${name}`);
    const tpl     = await tplRes.text();
    const css     = cssRes.ok ? await cssRes.text() : '';
    const ymlText = ymlRes.ok ? await ymlRes.text() : '';
    const themeYml = ymlText ? jsyaml.load(ymlText) || {} : {};
    const data = { compiled: Handlebars.compile(tpl), css, themeYml };
    themeCache.set(name, data);
    return data;
  }

  let currentYaml   = '';
  let currentResume = {};

  async function renderPreview(themeName) {
    if (!currentYaml) return;
    try {
      const { compiled, css, themeYml } = await loadTheme(themeName);
      const merged = mergeTokens(themeYml.tokens || {}, (currentResume.meta && currentResume.meta.tokens) || {});
      const tokens = flattenTokens(merged);
      $('preview').srcdoc = compiled(Object.assign({}, currentResume, { tokens, themeCSS: css }));
    } catch (e) {
      showError('render: ' + e.message);
    }
  }

  function setTitle() {
    const name  = (currentResume.person && currentResume.person.name)  || 'resume';
    const title = (currentResume.person && currentResume.person.title) || '';
    $('resume-title').textContent = name;
    $('resume-sub').textContent   = title;
    document.title = name + ' — resumelang';
    const editorLink = document.getElementById('btn-open-editor');
    if (editorLink) editorLink.href = '/editor' + location.hash;
  }

  function syntaxHighlight(yamlText) {
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return esc(yamlText)
      .replace(/^(\s*)(#.*)$/gm,          '$1<span style="color:#8b909c">$2</span>')
      .replace(/^(\s*)([\w\-.]+)(:)/gm,   '$1<span style="color:#7c8cff">$2</span>$3')
      .replace(/(:\s*)("[^"]*"|'[^']*')/g,'$1<span style="color:#4ade80">$2</span>');
  }

  // ── Tabs ───────────────────────────────────────────────────────

  document.querySelectorAll('.view-tabs .tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-tabs .tab').forEach(b => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', String(b === btn));
      });
      document.querySelectorAll('.view-pane').forEach(p => {
        p.hidden = p.id !== btn.dataset.target;
      });
    });
  });

  $('btn-copy-yaml').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(currentYaml);
      $('btn-copy-yaml').textContent = 'Copied ✓';
      setTimeout(() => { $('btn-copy-yaml').textContent = 'Copy YAML'; }, 1400);
    } catch (e) { showError('clipboard: ' + e.message); }
  });

  $('btn-print').addEventListener('click', () => {
    try { $('preview').contentWindow.focus(); $('preview').contentWindow.print(); }
    catch (e) { showError('print: ' + e.message); }
  });

  // ── Theme picker ───────────────────────────────────────────────

  function closeViewPicker() {
    const menu = $('theme-picker-menu');
    const btn  = $('theme-picker-btn');
    if (menu) menu.hidden = true;
    if (btn)  btn.setAttribute('aria-expanded', 'false');
  }

  function initViewThemePicker(themes, initial) {
    const btn  = $('theme-picker-btn');
    const menu = $('theme-picker-menu');
    if (!btn || !menu) return;

    themes.forEach(t => {
      const li = document.createElement('li');
      li.className = 'theme-picker-item';
      li.setAttribute('role', 'option');
      li.setAttribute('tabindex', '-1');
      li.dataset.theme = t;
      li.textContent = t;
      menu.appendChild(li);
    });

    function setViewTheme(name) {
      const label = $('theme-picker-label');
      if (label) label.textContent = name;
      menu.querySelectorAll('.theme-picker-item').forEach(li => {
        const active = li.dataset.theme === name;
        li.classList.toggle('active', active);
        li.setAttribute('aria-selected', String(active));
      });
      renderPreview(name);
    }

    menu.addEventListener('click', e => {
      const item = e.target.closest('.theme-picker-item');
      if (!item) return;
      closeViewPicker();
      setViewTheme(item.dataset.theme);
      btn.focus();
    });

    btn.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = !menu.hidden;
      menu.hidden = isOpen;
      btn.setAttribute('aria-expanded', String(!isOpen));
      if (!isOpen) {
        (menu.querySelector('.theme-picker-item.active') || menu.querySelector('.theme-picker-item'))?.focus();
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
      if      (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(idx + 1, items.length - 1)]?.focus(); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); if (idx <= 0) { closeViewPicker(); btn.focus(); } else items[idx - 1]?.focus(); }
      else if (e.key === 'Enter')     { e.preventDefault(); if (document.activeElement.dataset?.theme) { closeViewPicker(); setViewTheme(document.activeElement.dataset.theme); btn.focus(); } }
      else if (e.key === 'Escape')    { closeViewPicker(); btn.focus(); }
    });

    document.addEventListener('click', closeViewPicker);
    menu.addEventListener('click', e => e.stopPropagation());

    setViewTheme(initial);
  }

  // ── Init ───────────────────────────────────────────────────────

  (async () => {
    let yamlText;
    try {
      yamlText = await decodeShareYaml();
    } catch (e) {
      showError(e.message); return;
    }
    if (!yamlText) {
      showError('no resume data in URL — append #yml=… or visit / to create one'); return;
    }

    currentYaml = yamlText;
    try {
      currentResume = jsyaml.load(yamlText) || {};
    } catch (e) {
      showError('YAML: ' + e.message); return;
    }

    setTitle();
    $('source-code').innerHTML = syntaxHighlight(yamlText);

    // Theme picker
    let themes = ['sap'];
    try {
      const data = await fetch('/api/themes').then(r => r.json());
      themes = data.themes || themes;
    } catch { /* ignore */ }

    const initial = (currentResume.meta && currentResume.meta.theme) || themes[0];
    initViewThemePicker(themes, initial);
  })();
})();
