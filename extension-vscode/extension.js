const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const Handlebars = require('handlebars');
const jsyaml = require('js-yaml');

Handlebars.registerHelper('join', (arr, sep) => Array.isArray(arr) ? arr.join(sep) : '');
Handlebars.registerHelper('eq', (a, b) => String(a) === String(b));
Handlebars.registerHelper('default', (v, fallback) => (v === undefined || v === null || v === '') ? fallback : v);
Handlebars.registerHelper('upper', (s) => String(s || '').toUpperCase());
Handlebars.registerHelper('lower', (s) => String(s || '').toLowerCase());

const RESUME_FILE_RX = /resume.*\.ya?ml$/i;

let panel = null;
let galleryPanel = null;
let activeDoc = null;
let currentTheme = null;
let refreshTimer = null;
let extCtx = null;

function isResumeDoc(doc) {
  if (!doc) return false;
  return RESUME_FILE_RX.test(path.basename(doc.uri.fsPath || doc.fileName || ''));
}

function listThemes() {
  const dir = path.join(extCtx.extensionPath, 'themes');
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort();
  } catch {
    return ['minimal'];
  }
}

function defaultTheme() {
  return vscode.workspace.getConfiguration('resumelang').get('defaultTheme', 'minimal');
}

function refreshDelay() {
  return vscode.workspace.getConfiguration('resumelang').get('refreshDelay', 200);
}

function pickResumeDoc() {
  const ed = vscode.window.activeTextEditor;
  if (ed && isResumeDoc(ed.document)) return ed.document;
  if (activeDoc && !activeDoc.isClosed && isResumeDoc(activeDoc)) return activeDoc;
  for (const d of vscode.workspace.textDocuments) {
    if (isResumeDoc(d)) return d;
  }
  return null;
}

function uriFor(panel, ...segments) {
  return panel.webview.asWebviewUri(
    vscode.Uri.file(path.join(extCtx.extensionPath, ...segments))
  ).toString();
}

function buildHtml(panel) {
  const cspSource = panel.webview.cspSource;
  const previewHtml = fs.readFileSync(
    path.join(extCtx.extensionPath, 'web', 'preview.html'),
    'utf8'
  );

  return previewHtml
    .replace(/__CSP__/g, cspSource)
    .replace(/__PREVIEW_JS__/g, uriFor(panel, 'web', 'preview.js'))
    .replace(/__PREVIEW_CSS__/g, uriFor(panel, 'web', 'preview.css'))
    .replace(/__LOGO__/g, uriFor(panel, 'web', 'assets', 'logo.svg'))
    .replace(/__THEMES_BASE__/g, uriFor(panel, 'themes'));
}

function buildGalleryHtmlShell(p) {
  const cspSource = p.webview.cspSource;
  const html = fs.readFileSync(
    path.join(extCtx.extensionPath, 'web', 'gallery.html'),
    'utf8'
  );
  return html
    .replace(/__CSP__/g, cspSource)
    .replace(/__GALLERY_JS__/g, uriFor(p, 'web', 'gallery.js'))
    .replace(/__GALLERY_CSS__/g, uriFor(p, 'web', 'gallery.css'))
    .replace(/__LOGO__/g, uriFor(p, 'web', 'assets', 'logo.svg'));
}

function mergeTokens(base, override) {
  const out = Object.assign({}, base || {});
  if (!override || typeof override !== 'object') return out;
  for (const k of Object.keys(override)) {
    const bv = out[k];
    const ov = override[k];
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
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flattenTokens(v, key, out);
    } else {
      out[key] = v;
    }
  }
  return out;
}

function renderResume(yaml, template, themeCss, themeYml) {
  const resume = jsyaml.load(yaml) || {};
  const parsedYml = themeYml ? jsyaml.load(themeYml) || {} : {};
  const compiled = Handlebars.compile(template);
  const merged = mergeTokens(parsedYml.tokens || {}, (resume.meta && resume.meta.tokens) || {});
  const tokens = flattenTokens(merged);
  const ctx = Object.assign({}, resume, { tokens, themeCSS: themeCss || '' });
  return compiled(ctx);
}

function readThemeAssets(name) {
  const base = path.join(extCtx.extensionPath, 'themes', name);
  const tplPath = path.join(base, 'templates', 'resume.hbs');
  const cssPath = path.join(base, 'assets', 'style.css');
  const ymlPath = path.join(base, 'theme.yml');

  if (!fs.existsSync(tplPath)) {
    throw new Error(`theme "${name}" missing templates/resume.hbs`);
  }
  return {
    template: fs.readFileSync(tplPath, 'utf8'),
    css: fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '',
    themeYml: fs.existsSync(ymlPath) ? fs.readFileSync(ymlPath, 'utf8') : '',
  };
}

function postRender() {
  if (!panel) return;
  const doc = pickResumeDoc();
  if (!doc) {
    panel.webview.postMessage({ type: 'no-doc' });
    return;
  }
  activeDoc = doc;

  const theme = currentTheme || defaultTheme();
  let assets;
  try {
    assets = readThemeAssets(theme);
  } catch (e) {
    panel.webview.postMessage({ type: 'error', message: e.message });
    return;
  }

  let html;
  try {
    html = renderResume(doc.getText(), assets.template, assets.css, assets.themeYml);
  } catch (e) {
    panel.webview.postMessage({ type: 'error', message: e.message });
    return;
  }

  panel.webview.postMessage({
    type: 'render',
    html,
    theme,
    themes: listThemes(),
    css: assets.css,
    fileName: path.basename(doc.uri.fsPath || doc.fileName || 'resume.yml'),
  });
}

function scheduleRender() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(postRender, refreshDelay());
}

function ensurePanel() {
  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside, true);
    return panel;
  }

  panel = vscode.window.createWebviewPanel(
    'resumelangPreview',
    'ResumeLang Preview',
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(extCtx.extensionPath, 'web')),
        vscode.Uri.file(path.join(extCtx.extensionPath, 'themes')),
      ],
    }
  );

  const iconFile = path.join(extCtx.extensionPath, 'icon.png');
  if (fs.existsSync(iconFile)) {
    panel.iconPath = {
      light: vscode.Uri.file(iconFile),
      dark: vscode.Uri.file(iconFile),
    };
  }

  panel.webview.html = buildHtml(panel);

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'ready') {
      postRender();
    } else if (msg.type === 'set-theme') {
      currentTheme = msg.theme;
      postRender();
    } else if (msg.type === 'export-html') {
      await exportHtml(msg.html);
    } else if (msg.type === 'print-html') {
      await openForPrint(msg.html);
    } else if (msg.type === 'status') {
      // optional status forwarding ignored
    }
  });

  panel.onDidDispose(() => {
    panel = null;
    clearTimeout(refreshTimer);
  });

  return panel;
}

async function openForPrint(html) {
  const os = require('os');
  try {
    const tmp = path.join(os.tmpdir(), `resumelang-print-${Date.now()}.html`);
    const withAutoPrint = html.replace(
      /<\/body>/i,
      `<script>window.addEventListener('load', () => setTimeout(() => window.print(), 250));</script></body>`
    );
    fs.writeFileSync(tmp, withAutoPrint, 'utf8');
    await vscode.env.openExternal(vscode.Uri.file(tmp));
  } catch (e) {
    vscode.window.showErrorMessage(`Print failed: ${e.message}`);
  }
}

function loadSampleYaml() {
  const samplePath = path.join(extCtx.extensionPath, 'assets', 'sample.yml');
  try {
    return fs.readFileSync(samplePath, 'utf8');
  } catch {
    return 'person:\n  name: Sample User\n  title: Software Engineer\nsummary: Sample resume.\n';
  }
}

function renderGalleryItems() {
  const sample = activeDoc && !activeDoc.isClosed ? activeDoc.getText() : loadSampleYaml();
  const themes = listThemes();
  const out = [];
  for (const name of themes) {
    let assets;
    try {
      assets = readThemeAssets(name);
    } catch {
      continue;
    }
    let html;
    try {
      html = renderResume(sample, assets.template, assets.css, assets.themeYml);
    } catch {
      continue;
    }
    let version = '';
    try {
      const parsed = jsyaml.load(assets.themeYml || '') || {};
      version = parsed.version || '';
    } catch { /* ignore */ }
    out.push({ name, html, version });
  }
  return out;
}

function ensureGallery() {
  if (galleryPanel) {
    galleryPanel.reveal(vscode.ViewColumn.Active, false);
    return galleryPanel;
  }

  galleryPanel = vscode.window.createWebviewPanel(
    'resumelangGallery',
    'ResumeLang — Theme Gallery',
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(extCtx.extensionPath, 'web')),
        vscode.Uri.file(path.join(extCtx.extensionPath, 'themes')),
      ],
    }
  );

  const iconFile = path.join(extCtx.extensionPath, 'icon.png');
  if (fs.existsSync(iconFile)) {
    galleryPanel.iconPath = {
      light: vscode.Uri.file(iconFile),
      dark: vscode.Uri.file(iconFile),
    };
  }

  galleryPanel.webview.html = buildGalleryHtmlShell(galleryPanel);

  galleryPanel.webview.onDidReceiveMessage((msg) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'ready') {
      try {
        const items = renderGalleryItems();
        galleryPanel.webview.postMessage({
          type: 'init',
          themes: items,
          active: currentTheme || defaultTheme(),
        });
      } catch (e) {
        galleryPanel.webview.postMessage({ type: 'error', message: e.message });
      }
    } else if (msg.type === 'apply-theme') {
      currentTheme = msg.theme;
      if (panel) {
        postRender();
      } else if (pickResumeDoc()) {
        ensurePanel();
      }
      galleryPanel.webview.postMessage({ type: 'set-active', theme: msg.theme });
    } else if (msg.type === 'close') {
      galleryPanel.dispose();
    }
  });

  galleryPanel.onDidDispose(() => {
    galleryPanel = null;
  });

  return galleryPanel;
}

async function exportHtml(html) {
  const target = await vscode.window.showSaveDialog({
    filters: { HTML: ['html'] },
    defaultUri: vscode.Uri.file(path.join(
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
      'resume.html'
    )),
  });
  if (!target) return;
  try {
    fs.writeFileSync(target.fsPath, html, 'utf8');
    vscode.window.showInformationMessage(`Saved ${path.basename(target.fsPath)}`);
  } catch (e) {
    vscode.window.showErrorMessage(`Export failed: ${e.message}`);
  }
}

function activate(context) {
  extCtx = context;

  context.subscriptions.push(
    vscode.commands.registerCommand('resumelang.preview', () => {
      const doc = pickResumeDoc();
      if (!doc) {
        vscode.window.showWarningMessage(
          'Open a resume YAML file first (resume.yml or *.resume.yml).'
        );
        return;
      }
      activeDoc = doc;
      ensurePanel();
    }),

    vscode.commands.registerCommand('resumelang.selectTheme', () => {
      ensureGallery();
    }),

    vscode.commands.registerCommand('resumelang.themeGallery', () => {
      ensureGallery();
    }),

    vscode.commands.registerCommand('resumelang.exportHtml', () => {
      if (!panel) {
        vscode.window.showWarningMessage('Open the preview first.');
        return;
      }
      panel.webview.postMessage({ type: 'request-export' });
    }),

    vscode.commands.registerCommand('resumelang.print', () => {
      if (!panel) {
        vscode.window.showWarningMessage('Open the preview first.');
        return;
      }
      panel.webview.postMessage({ type: 'request-print' });
    }),

    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!panel) return;
      if (!isResumeDoc(e.document)) return;
      activeDoc = e.document;
      scheduleRender();
    }),

    vscode.window.onDidChangeActiveTextEditor((ed) => {
      if (!panel || !ed) return;
      if (isResumeDoc(ed.document)) {
        activeDoc = ed.document;
        postRender();
      }
    }),

    vscode.workspace.onDidOpenTextDocument((doc) => {
      const cfg = vscode.workspace.getConfiguration('resumelang');
      if (!cfg.get('openPreviewOnResumeFile', false)) return;
      if (!isResumeDoc(doc)) return;
      if (panel) return;
      activeDoc = doc;
      ensurePanel();
    }),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('resumelang.defaultTheme') && !currentTheme) {
        postRender();
      }
    })
  );
}

function deactivate() {
  if (panel) panel.dispose();
}

module.exports = { activate, deactivate };
