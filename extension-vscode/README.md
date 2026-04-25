# Resume Lang VSCode Extension

Live preview for resume.yml files - choose from built-in themes or external GitHub themes.

## Features

- Live preview panel with rendered HTML
- Built-in themes: minimal, bold, developer, aurora, terminal, material  
- External GitHub theme support
- Auto-refresh on save

## Setup

### 1. Build Go binary for your platform

```bash
# Linux/macOS
GOOS=linux GOARCH=amd64 go build -o bin/resumelang
GOOS=darwin GOARCH=amd64 go build -o bin/resumelang-darwin

# Windows
go build -o bin/resumelang.exe
```

### 2. Copy themes

```bash
cp -r ../themes ./themes
```

### 3. Install extension

```bash
# Open VSCode and run "Developer: Install Extension from Location"
# Or package with vsce
npm install -g @vscode/vsce
vsce package
```

### 4. Install binary from GitHub releases (if published)

The extension will automatically download the CLI binary from GitHub releases if not found locally.

## Usage

1. Open a `resume.yml` file
2. Press `Ctrl+Shift+P` → "Resume: Show Preview"
3. Choose a theme from the dropdown
4. For external themes, enter a GitHub URL like `github.com/user/resume-theme`

## Commands

| Command | Description |
|---------|-------------|
| `resumelang.preview` | Open preview panel |
| `resumelang.theme` | Choose default theme |

## Configuration

```json
{
  "resumelang.theme": "aurora"
}
```

## Adding Themes

Place themes in `./themes/` folder:
```
themes/
├── aurora/
│   ├── theme.yml
│   ├── templates/resume.html
│   └── assets/style.css
├── minimal/
│   └── ...
```

Or use external GitHub repo:
```bash
resumelang build resume.yml --theme github.com/owner/theme-repo
```

## Development

```bash
# Watch mode
npm run watch

# Package
vsce package
```