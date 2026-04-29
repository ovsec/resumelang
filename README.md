# resumelang

**One `resume.yml`. Every format.**

Write your resume as structured YAML. Get themed HTML, ATS plain text, JSON Resume, and Markdown — from a single Go binary that doubles as a CLI, a live web editor, and a CI target.

[![Go](https://img.shields.io/badge/go-1.22+-00ADD8?style=flat&logo=go)](https://golang.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-resumelang.dev-7c8cff?style=flat)](https://docs.resumelang.dev)

---

![resumelang editor — YAML on the left, live resume preview on the right](https://resumelang.dev/web/assets/screenshot.png)

---

## Why

Your resume is structured data — a name, jobs, dates, skills. Not a Word document.

Once it's YAML it becomes:

- **Diffable.** `git diff` shows every change across every version.
- **Re-themable.** Swap `meta.theme: sap` to `meta.theme: aurora`. Same content, new look.
- **Multi-format.** One source → HTML + PDF + JSON Resume + ATS text + Markdown.
- **Portable.** Single Go binary. No Node, no Python, no Docker required.
- **Schema-validated.** VS Code autocompletes fields and red-squiggles typos.

---

## Three ways to use it

### 1. Web editor (hosted)

Visit **[resumelang.dev](https://resumelang.dev)** — no install needed.

- Live YAML editor with instant preview
- 13 built-in themes
- Download HTML, ATS text, or print to PDF
- Share via encrypted URL (AES-GCM, decrypted in-browser)
- Sign in with GitHub or LinkedIn to save resumes to your dashboard

### 2. CLI (local)

```bash
go install github.com/ovsec/resumelang@latest

resumelang init                          # scaffold resume.yml
resumelang build resume.yml              # → dist/ with all formats
resumelang serve                         # local editor at http://localhost:3000
resumelang validate resume.yml           # schema check
```

### 3. GitHub Actions (CI)

Push `resume.yml`, get a live GitHub Pages site. Drop this into `.github/workflows/resume.yml`:

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

Enable Pages under **Settings → Pages → Source: GitHub Actions**, then push.

---

## Quickstart

```bash
# Install
go install github.com/ovsec/resumelang@latest

# Create starter resume
resumelang init
# → resume.yml

# Build all formats
resumelang build resume.yml
# → dist/resume.html
# → dist/resume.json
# → dist/resume.md
# → dist/resume.txt

# Open live editor
resumelang serve
# → http://localhost:3000
```

---

## resume.yml format

```yaml
# yaml-language-server: $schema=https://resumelang.dev/schema/v1.json
resumelang: v1

meta:
  theme: sap          # sap | minimal | aurora | material | vercel | linear | brutalist | ...
  language: en        # en | de | fr | es | pt | ja | zh
  page_size: a4       # a4 | letter
  color: "#0070f2"    # accent color override
  sections:
    - summary
    - experience
    - education
    - skills
    - projects
    - certifications

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
    end:      ""           # blank = Present
    highlights:
      - Scaled API to 10M requests/day
      - Reduced CI deploy time by 60%
    tags: [Go, Kubernetes, Postgres]

education:
  - institution: KTH Royal Institute of Technology
    degree: MSc
    field:  Computer Science
    start:  "2013"
    end:    "2015"

skills:
  - category: Languages
    skills: [Go, TypeScript, Python, Rust]

projects:
  - name:        gitshare
    description: P2P git repo sharing. Zero-dependency single binary.
    url:         https://github.com/ashoksaha/gitshare
    tags: [Go, P2P, CLI]
```

Full schema reference → [docs.resumelang.dev/schema](https://docs.resumelang.dev/schema)

---

## Themes

13 built-in themes. Switch with one line in YAML or from the editor dropdown.

| Theme | Style |
|-------|-------|
| `sap` | Two-column, sidebar, consulting/finance |
| `minimal` | One-page, clean, ATS-friendly |
| `aurora` | Modern gradient, designer-leaning |
| `material` | Card-based grid, tech roles |
| `vercel` | Dark, minimal, developer aesthetic |
| `linear` | Clean timeline layout |
| `brutalist` | High contrast, editorial |
| `terminal` | Monospace, dark, hacker |
| `editorial` | Magazine-style typography |
| `dossier` | Dense, document-style |
| `academic` | CV format, publications-friendly |
| `finance` | Formal, two-column, banking/consulting |
| `timeline` | Visual timeline for experience |

Custom themes use a `theme.yml` spec — validated at build time:

```bash
resumelang theme validate ./my-theme
```

---

## CLI reference

| Command | Purpose |
|---------|---------|
| `init [file]` | Scaffold a starter `resume.yml` |
| `build [file]` | Compile to `html`, `json`, `md`, `txt` |
| `validate [file]` | Schema check + warnings |
| `serve [--port N]` | Launch local web editor |
| `themes` | List built-in themes |
| `theme validate <dir>` | Lint a custom theme |
| `version` | Print binary version |

**Build flags:**

```bash
resumelang build resume.yml --out public --formats html,txt
resumelang build jane.resume.yml --theme aurora
```

---

## Self-hosting the editor

```bash
git clone https://github.com/ovsec/resumelang
cd resumelang
go build -o resumelang .
./resumelang serve --port 8080
```

OAuth login (optional):

```bash
export RL_GITHUB_CLIENT_ID=...
export RL_GITHUB_CLIENT_SECRET=...
export RL_AUTH_SECRET=<32-byte random string>
./resumelang serve
```

Docker:

```bash
docker build -t resumelang .
docker run -p 8080:8080 resumelang
```

---

## Output formats

| Format | File | Notes |
|--------|------|-------|
| HTML | `resume.html` | Themed, print-ready, self-contained |
| JSON | `resume.json` | [jsonresume.org](https://jsonresume.org) schema |
| Markdown | `resume.md` | GitHub-flavored |
| ATS text | `resume.txt` | Plain text, safe for applicant tracking systems |
| PDF | — | Print `resume.html` from browser; native export coming |

---

## Roadmap

### Near-term (v0.x)

| Feature | Status |
|---------|--------|
| `resumelang lint` — ATS keyword density, date gaps, weak verbs | Planned |
| LinkedIn import — `import linkedin export.zip` → YAML | Planned |
| JSON Resume import — `import jsonresume resume.json` | Planned |
| Live reload SSE — `serve` hot-reloads when `resume.yml` changes on disk | Planned |
| Publish to GitHub Pages — one-click from the web editor | Planned |
| Resume version history — diff view for saved resumes on dashboard | Planned |
| `resumelang diff a.yml b.yml` — semantic section-level diff | Planned |

### Medium-term (v1.x)

| Feature | Status |
|---------|--------|
| AI tailoring — paste a job description, get keyword gap analysis | Planned |
| Share link analytics — open counts, last-seen timestamp (no tracking pixels) | Planned |
| Community theme registry — `resumelang theme install user/repo` | Planned |
| Custom domain publishing — `resume.yourname.com` → hosted resume | Planned |
| Multi-resume workspaces — manage role-targeted resume variants | Planned |
| Collaborative review — share editor access for mentor feedback | Planned |

### Later / Pro

| Feature | Notes |
| ------- | ----- |
| Cover letter generator | Co-authored with AI from resume + job description |
| Webhook API | Programmatic build triggers |
| SSO / team accounts | For career coaches and recruiting firms |

Full roadmap → [docs.resumelang.dev/roadmap](https://docs.resumelang.dev/roadmap)

---

## Contributing

```bash
git clone https://github.com/ovsec/resumelang
cd resumelang
go mod tidy
go build -o resumelang .
go test ./...
./resumelang serve   # opens editor at http://localhost:3000
```

- Issues and feature requests → [GitHub Issues](https://github.com/ovsec/resumelang/issues)
- New themes welcome — see [Themes docs](https://docs.resumelang.dev/themes) for the `theme.yml` spec
- All PRs should pass `go test ./...` and `resumelang validate examples/sap-consultant.resume.yml`

---

## Credits

Built with open source:

| Library | Use |
| ------- | --- |
| [Go Fiber](https://gofiber.io) | Web framework |
| [HTMX](https://htmx.org) | Server-driven UI |
| [CodeMirror](https://codemirror.net) | Code editor |
| [raymond](https://github.com/aymerick/raymond) | Handlebars templates |
| [yaml.v3](https://github.com/go-yaml/yaml) | YAML parsing |
| [Inter](https://rsms.me/inter) | UI typeface |
| [JetBrains Mono](https://www.jetbrains.com/lp/mono/) | Code typeface |

---

## License

MIT © [Abhishek Saha](https://github.com/ovsec)
