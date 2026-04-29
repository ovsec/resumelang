# resumelang — Claude Code Context

## What this project is

A universal resume DSL compiler + graphical editor written in Go. Users author a
single `resume.yml` (or markdown), and resumelang compiles it to multiple formats.
Git-native, offline-first. Ships as **one single binary** that doubles as a CLI
and a self-hosted web editor.

## Three usage paths

1. **Hosted web editor** — visit the public site (run by maintainer), edit a
   resume graphically (markdown or YAML, bidirectional), preview live, then
   download artifacts or publish to a user's GitHub repo.
2. **Git push → CI** — user keeps `resume.yml` in their own repo. On push, a
   GitHub Action runs the resumelang binary, compiles to HTML/PDF/JSON/MD/TXT,
   and publishes to GitHub Pages.
3. **Local CLI** — run the binary on a laptop. Same compiler. No network.

All three paths share **one codebase, one binary**.

## Project status

**Phase 1 — core editor shipped.** Web editor live with themes, share links,
dashboard, OAuth, VSCode extension, and CLI. Working toward lint, imports, and
publish flow.

---

## Module

```text
module github.com/ovsec/resumelang
go 1.22
```

GitHub username for canonical hosting: **ovsec** (`github.com/ovsec/resumelang`).

---

## Architecture

```text
                       ┌─────────────────────────────────────┐
                       │           resumelang (single binary) │
                       └─────────────────────────────────────┘
                                          │
       ┌──────────────────────┬───────────┴────────────┬───────────────────────┐
       ▼                      ▼                        ▼                       ▼
   `build`              `serve` (web)               `validate`               `init`
   compile YAML → out   embedded Fiber app          schema check             starter file
                        + CodeMirror editor
                        + HTMX previews

resume.yml ──► internal/parser ──► internal/schema ──► internal/compiler ──► html/pdf/json/md/txt
                                          ▲
                                          │
                  resume.md ──► internal/mdsync (md ↔ schema bidirectional)
```

### Repo layout

```text
resumelang/
├── CLAUDE.md
├── go.mod                          # module github.com/ovsec/resumelang
├── main.go                         # entrypoint → cmd.Execute()
├── cmd/                            # CLI dispatch + commands
│   ├── root.go                     # arg routing, usage
│   ├── build.go                    # `build` command
│   ├── validate.go                 # `validate` command
│   ├── init.go                     # `init` command
│   ├── themes.go                   # `themes` command
│   └── serve.go                    # `serve` command (launches web editor)
├── internal/
│   ├── schema/schema.go            # Resume IR (Go structs)
│   ├── parser/parser.go            # YAML → schema, validate, defaults
│   ├── compiler/
│   │   ├── compiler.go             # JSON Resume, ATS text, Markdown
│   │   ├── html.go                 # 3 themes (minimal | bold | developer)
│   │   └── pdf.go                  # TODO: Puppeteer subprocess
│   ├── mdsync/mdsync.go            # markdown ↔ schema (bidirectional)
│   └── web/                        # web editor (embedded in binary)
│       ├── server.go               # Fiber app, route registration
│       ├── handlers.go             # /editor/sync, /editor/theme, /publish, /import/*
│       ├── assets.go               # //go:embed templates/* static/*
│       ├── templates/index.html    # editor shell
│       └── static/
│           ├── editor.js           # CodeMirror 6 setup + Typora-style decorations
│           └── styles.css          # custom on top of Tailwind CDN
├── examples/jane.yml               # demo resume
└── .github/workflows/resume.yml    # GitHub Action template (path 2)
```

---

## Editor — `resumelang serve`

Launches the web editor on `:7070` (configurable via `--port`). Embedded in the
single binary via `embed.FS`, so no extra files at runtime.

**Stack:** Go Fiber + HTMX + CodeMirror 6 + Tailwind (all client deps from CDN,
no JS/CSS build step).
**Source of truth:** both markdown and YAML — bidirectional sync via
`POST /editor/sync`.
**Inline preview:** CodeMirror Decoration API (Typora-style — render headings,
tags, etc. inline as the user types).

### Resume markdown conventions (mdsync)

| Markdown                         | Maps to                          |
|----------------------------------|----------------------------------|
| `# Name`                         | `person.name`                    |
| `### Role @ Company`             | `experience[].role` + `.company` |
| `` `2021` – `Present` ``         | `experience[].start` + `.end`    |
| `> tag · tag · tag`              | `experience[].tags` (blockquote) |
| `**Category:** x · y · z`        | `skills[].category` + `.skills`  |
| `- highlight bullet`             | `experience[].highlights[]`      |

### Web endpoints

| Method | Path               | Body / params         | Returns                                     |
|--------|--------------------|-----------------------|---------------------------------------------|
| GET    | `/`                | —                     | editor HTML shell                           |
| POST   | `/editor/sync`     | `{content, mode}`     | `{yaml, markdown, preview_html}`            |
| POST   | `/editor/theme`    | `{theme, color}`      | `{preview_html}`                            |
| POST   | `/publish`         | `{yaml}`              | `{url}` or `{error}` (publishes via GitHub) |
| GET    | `/import/github`   | `?user=<gh>&repo=<r>` | `{markdown}`                                |
| POST   | `/import/linkedin` | multipart zip         | `{markdown}`                                |
| GET    | `/static/*`        | —                     | embedded JS/CSS                             |

`mode` in `/editor/sync` is `"md"` or `"yaml"` — server converts the source side
into the other side and re-renders the preview.

---

## Core types (internal/schema/schema.go)

```go
type Resume struct {
    Meta           Meta
    Person         Person
    Summary        string
    Experience     []Job
    Education      []Education
    Skills         []SkillGroup
    Projects       []Project
    Publications   []Publication
    Certifications []Certification
    Languages      []Language
    Volunteer      []Volunteer
    Awards         []Award
    Custom         []Section
}

type Meta struct {
    Theme    string   // minimal | bold | developer
    Language string   // en, de, fr, ...
    Color    string   // hex accent e.g. "#6366f1"
    Font     string   // inter | mono | serif
    PageSize string   // a4 | letter
    Sections []string // controls order + visibility
}
```

Full types in `internal/schema/schema.go`.

---

## DSL format (what users write)

```yaml
meta:
  theme: minimal        # minimal | bold | developer
  color: "#6366f1"
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

person:
  name: Jane Doe
  title: Senior Software Engineer
  email: jane@example.com
  phone: +1 555 000 0000
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
    end: ""            # empty = Present
    description: Led the platform team.
    highlights:
      - Scaled API to 10M requests/day
      - Reduced deploy time by 60%
    tags: [Go, Kubernetes, Postgres]
    url: https://acme.com

education:
  - institution: KTH Royal Institute of Technology
    degree: MSc
    field: Computer Science
    start: "2013"
    end: "2015"
    gpa: "4.0"

skills:
  - category: Languages
    skills: [Go, TypeScript, Python, Rust]

projects:
  - name: gitshare
    description: P2P git repo sharing via bore.pub
    url: https://github.com/you/gitshare
    highlights:
      - Zero-dependency single binary
    tags: [Go, P2P]
```

---

## CLI commands

| Command                                 | Status     | Notes                                        |
|-----------------------------------------|------------|----------------------------------------------|
| `resumelang init [file]`                | scaffolded | writes starter resume.yml                    |
| `resumelang build [file] [flags]`       | scaffolded | compile to html/json/md/txt                  |
| `resumelang validate [file]`            | scaffolded | schema check                                 |
| `resumelang themes`                     | scaffolded | list built-in themes                         |
| `resumelang serve [--port N]`           | scaffolded | launch web editor                            |
| `resumelang version`                    | scaffolded | print version                                |
| `resumelang lint [file]`                | TODO       | ATS keyword + readability score              |
| `resumelang diff [a] [b]`               | TODO       | diff two resumes                             |
| `resumelang import linkedin <zip>`      | TODO       | LinkedIn export → resume.yml                 |
| `resumelang import jsonresume <json>`   | TODO       | JSON Resume → resume.yml                     |
| `resumelang pdf [file]`                 | dropped    | PDF via browser print (window.print)         |

### `build` flags

```text
--out <dir>          output directory (default: dist)
--formats <list>     comma-separated: html,json,txt,md (default: all)
```

---

## Output formats

| Format    | File          | Standard                          |
|-----------|---------------|-----------------------------------|
| HTML      | resume.html   | Themed, print-ready               |
| PDF       | —             | Browser print on preview iframe   |
| JSON      | resume.json   | jsonresume.org schema             |
| Markdown  | resume.md     | GitHub-flavored                   |
| ATS text  | resume.txt    | Plain text, ATS-safe              |

---

## Theme system (v3)

resumelang supports **community-contributed themes** using a hybrid model:

> Theme = **theme.yml (schema-validated) + templates + assets**

Themes are **strictly validated** against a versioned specification to ensure:

* stability across releases
* safe rendering
* ecosystem compatibility

---

## ThemeSpec

All themes MUST include a `theme.yml` that conforms to a versioned schema.

```yaml
spec: v1
```

---

## Full `theme.yml` schema (v1)

```yaml
spec: v1

name: aurora
version: 1.0.0
author: your-name

supports:
  layouts: [timeline, grid, cards]
  blocks: [bullets, tags, metrics, text]

  ui:
    variant: [card, compact]
    emphasis: [low, medium, high]

features:
  dark_mode: true
  responsive: true

layout:
  experience: timeline
  skills: grid
  projects: cards

components:
  experience:
    default: timeline_item

  blocks:
    bullets: bullet_list
    tags: pill_group
    metrics: stat_cards
    text: paragraph

tokens:
  spacing:
    section_gap: 24
    item_gap: 12

  typography:
    heading_weight: 600
    body_size: 14

  radius:
    base: 8

variants:
  card:
    padding: md
    shadow: sm
    border: true
```

---

## Validation rules (enforced)

### 1. Required fields

* `spec`
* `name`
* `version`
* `supports`

---

### 2. Versioning

* `spec` must match supported versions (`v1`)
* unknown versions → hard error

---

### 3. Unknown keys

* top-level unknown keys → warning (future-proofing)
* unknown keys inside strict sections (`supports`, `components`) → error

---

### 4. Components

All declared components MUST have corresponding templates:

```text
templates/blocks/stat_cards.html
templates/experience/timeline_item.html
```

Missing template → build error

---

### 5. Blocks

* Only blocks listed in `supports.blocks` are allowed
* If DSL uses unsupported block → ignored (soft fail)

---

### 6. UI hints

```yaml
supports:
  ui:
    variant: [card, compact]
```

Rules:

* unsupported UI hints → ignored
* invalid values → warning

---

### 7. Tokens

* must be primitive values (string, number, bool)
* nested objects allowed
* compiler flattens into CSS variables

---

### 8. Layout keys

* must match known sections (`experience`, `skills`, etc.)
* unknown section → warning

---

## Compiler behavior (strict)

### Load phase

```text
1. read theme.yml
2. validate against ThemeSpec
3. load templates
4. verify component-template mapping
```

---

### Runtime guarantees

* no missing templates at render time
* deterministic output
* graceful degradation for unsupported features

---

## Error levels

| Level  | Behavior               |
| ------ | ---------------------- |
| ERROR  | build fails            |
| WARN   | build continues + logs |
| IGNORE | silently skipped       |

---

## Token resolution

Final tokens are merged in this order:

```text
1. theme defaults (theme.yml)
2. user meta.tokens
3. system defaults
```

Then exposed as CSS variables:

```css
:root {
  --rl-spacing-section-gap: 24px;
  --rl-typography-heading-weight: 600;
}
```

---

## Component resolution

```text
DSL block → theme.yml mapping → template path
```

Example:

```yaml
blocks:
  metrics: stat_cards
```

Resolves to:

```text
templates/blocks/stat_cards.html
```

---

## Template contract

Templates receive a stable context:

```go
type RenderContext struct {
    Resume Resume
    Meta   Meta
    Tokens map[string]any
    Theme  ThemeConfig
}
```

---

## Theme validation CLI

```bash
resumelang theme validate ./themes/aurora
```

Checks:

* schema compliance
* template existence
* mapping integrity
* token validity

---

## Theme development workflow

```bash
resumelang theme init my-theme
resumelang theme validate ./my-theme
resumelang serve --theme ./my-theme
```

---

## Forward compatibility

### Spec evolution

```yaml
spec: v2
```

Rules:

* older CLI → reject newer spec
* newer CLI → support older specs

---

## Deprecation model

* fields marked deprecated → warning
* removed only in major spec versions

---

## Security model

## Safe themes (default)

* HTML templates only
* no JS execution
* sanitized output

## Advanced themes (future)

* WASM sandbox
* explicit opt-in

---

## Design principles (theme system)

1. **Strict contracts enable ecosystems**
2. **Validation > flexibility**
3. **Themes control UI, not DSL**
4. **Graceful degradation always**
5. **Spec versioning prevents breakage**

---

## Key insight

A theme system without a schema becomes chaos.

A theme system with a schema becomes a platform.

resumelang is building a platform.

---

## GitHub Action (path 2)

Template at `.github/workflows/resume.yml` — users copy into their own repo.
Builds `go install github.com/ovsec/resumelang@latest`, runs the CLI, deploys
the `dist/` folder to GitHub Pages on every push to `resume.yml`.

```yaml
on:
  push:
    paths: ["resume.yml"]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: "1.22" }
      - run: go install github.com/ovsec/resumelang@latest
      - run: resumelang build resume.yml --out dist
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
      - uses: actions/deploy-pages@v4
```

---

## Distribution

### Release process

Tag a commit → GitHub Actions runs GoReleaser → binaries uploaded to GitHub Releases
→ Homebrew tap + Scoop bucket manifests auto-updated by GoReleaser.

```bash
git tag v0.2.0
git push origin v0.2.0
```

### Install methods

| Method | Command |
| ------ | ------- |
| `go install` | `go install github.com/ovsec/resumelang@latest` |
| `curl \| sh` | `curl -sSfL https://raw.githubusercontent.com/ovsec/resumelang/main/install.sh \| sh` |
| Homebrew | `brew install ovsec/tap/resumelang` |
| Scoop | `scoop bucket add ovsec https://github.com/ovsec/scoop-resumelang && scoop install resumelang` |
| Winget | `winget install ovsec.resumelang` |
| Manual | Download from GitHub Releases, extract, add to PATH |

### Required GitHub secrets for release

| Secret | Purpose |
| ------ | ------- |
| `GITHUB_TOKEN` | Auto-provided — uploads release assets |
| `HOMEBREW_TAP_GITHUB_TOKEN` | PAT with `repo` scope on `ovsec/homebrew-tap` |
| `SCOOP_BUCKET_GITHUB_TOKEN` | PAT with `repo` scope on `ovsec/scoop-resumelang` |

### VSCode extension

**Fully offline** — bundles Handlebars + js-yaml + themes inside the `.vsix`.
No CLI binary needed. Renders in a WebviewPanel using only the bundled assets.

```bash
cd extension-vscode
npm install
npx vsce package          # → resumelang-x.y.z.vsix
npx vsce publish          # requires VSCE_PAT env var
```

Future: if the extension gains a "build" / "validate" command it will shell out to
the `resumelang` binary found in PATH, with a graceful prompt to install if missing.

---

## Development commands

```bash
go mod tidy
go build -o resumelang .

./resumelang init
./resumelang build examples/jane.yml
./resumelang validate examples/jane.yml
./resumelang serve --port 7070      # opens web editor

go test ./...
go install .
```

---

## File naming convention

* Input: `*.yml` or `*.resume.yml` (both accepted)
* Output base strips `.resume` suffix:
  * `jane.resume.yml` → `jane.html`, `jane.pdf`, ...
  * `resume.yml` → `resume.html`, `resume.pdf`, ...

---

## Design principles

1. **One binary, three paths** — CLI, web editor, and CI all run the same code.
2. **Zero required config** — `resumelang build` just works on any `resume.yml`.
3. **Offline-first** — no cloud dependency to compile; web editor is optional.
4. **Git-native** — `resume.yml` is the source of truth, diffs are readable.
5. **ATS-safe** — plain text output is always available for job applications.
6. **Portable** — single Go binary, no Node/Python runtime needed.
7. **Extensible** — theme system and compiler interface ready for plugins.

---

## Build order (current)

1. ✅ Module setup, schema IR, parser
2. ✅ Compilers: HTML (multi-theme via theme.yml), JSON, ATS, Markdown
3. ✅ CLI: `init`, `build`, `validate`, `themes`, `version`
4. ✅ `mdsync` skeleton (md → schema, schema → md)
5. ✅ `serve` web editor (Fiber + embedded assets, live preview)
6. ✅ GitHub Action template
7. ✅ Auth (GitHub OAuth, session cookies)
8. ✅ Dashboard + saved resumes (file-backed store)
9. ✅ Share links — gzip URL hash, AES-GCM password encryption, short `#id=` for saved resumes
10. ✅ Public `/r` view page (client-side Handlebars rendering)
11. ✅ VSCode extension scaffold
12. ✅ PDF via browser print (`window.print()` on preview iframe)
13. ⏳ `lint` — ATS keyword density, date gaps, weak achievement verbs
14. ⏳ `import linkedin` — parse LinkedIn export zip → YAML
15. ⏳ `import jsonresume` — JSON Resume schema → YAML
16. ⏳ Publish flow — one-click push to GitHub Pages from editor
17. ⏳ Live reload SSE — `serve` watches `resume.yml` and pushes updates
18. ⏳ Resume version history — diff view on dashboard
19. ⏳ AI tailoring — job description → keyword gap overlay
20. ⏳ Share link analytics — open counts per link
21. ⏳ Community theme registry — `resumelang theme install user/repo`
