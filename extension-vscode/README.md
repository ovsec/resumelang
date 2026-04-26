# ResumeLang for VS Code

Live preview, schema validation, and theme switching for **resumelang** YAML resumes — all rendered in-process. No CLI binary, no external server.

## Features

- **Live preview** in a side panel — re-renders as you type (debounced).
- **Schema validation** via `redhat.vscode-yaml` — autocomplete, hover docs, error squiggles for `resume.yml`, `*.resume.yml`.
- **Theme switching** — built-in: `minimal`, `aurora`, `material`, `terminal`, `sap`. Add your own under `themes/`.
- **Print / Save as PDF** through the system print dialog (Ctrl/Cmd+P inside the preview).
- **Export standalone HTML** — single self-contained file with theme CSS inlined.
- **Pure JS rendering** — Handlebars + js-yaml in a webview. Same templates as the CLI and the web editor.

## Quick start

1. Open any `resume.yml` (or `*.resume.yml`) file.
2. Run **ResumeLang: Open Preview** from the command palette, or click the preview icon in the editor title bar.
3. Run **ResumeLang: Select Theme** to switch themes on the fly.

## Commands

| Command | Description |
| --- | --- |
| `ResumeLang: Open Preview` | Opens the live preview panel beside the editor. |
| `ResumeLang: Select Theme` | Quick-pick from installed themes. |
| `ResumeLang: Export Standalone HTML` | Save the rendered HTML to disk. |
| `ResumeLang: Print / Save as PDF` | Open the system print dialog for the preview. |

## Settings

| Key | Default | Description |
| --- | --- | --- |
| `resumelang.defaultTheme` | `minimal` | Theme used when opening a fresh preview. |
| `resumelang.refreshDelay` | `200` | Debounce (ms) between edits and preview refresh. |
| `resumelang.openPreviewOnResumeFile` | `false` | Auto-open preview when a resume file is opened. |

## Architecture

```text
vscode editor (resume.yml)
        │   onDidChangeTextDocument (debounced)
        ▼
extension.js  ──► reads themes/<name>/{templates/resume.hbs, assets/style.css, theme.yml}
        │   postMessage({yaml, theme, template, css, themeYml})
        ▼
webview (preview.html)
        │   js-yaml.load(yaml) → Handlebars.compile(template)(ctx)
        ▼
iframe srcdoc (themed resume HTML)
```

## Adding a theme

Drop a folder under `themes/`:

```text
themes/<name>/
├── theme.yml                 # spec: v1, name, version, supports, tokens, ...
├── templates/resume.hbs      # Handlebars template
└── assets/style.css          # injected via {{{themeCSS}}}
```

The Handlebars context is the parsed YAML (lowercase keys) plus:

- `themeCSS` — raw stylesheet (use `{{{themeCSS}}}` to inline)
- `tokens` — flattened design tokens (e.g. `tokens.colors_background`)

Built-in helpers: `join`, `eq`, `default`, `upper`, `lower` — match the Go side exactly.

## Development

```bash
# from extension-vscode/
./sync.sh                 # mirror themes/ + schema/ + vendor libs from ../
code --install-extension . # or: F5 in VS Code to launch Extension Host
vsce package              # build .vsix
```

The extension has no build step — `extension.js` and `web/*` ship as-is.

## Schema

`resume.yml` files are validated against `schema/v1.json` (JSON Schema draft-07).
The mapping is contributed via `yamlValidation` so it works without any user
configuration. Add this preamble for the same support outside this extension:

```yaml
# yaml-language-server: $schema=https://resumelang.dev/schema/v1.json
resumelang: v1
```
