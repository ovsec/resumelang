package cmd

import (
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/ovsec/resumelang/internal/compiler"
	"github.com/ovsec/resumelang/internal/parser"
)

func Build(args []string) {
	file := "resume.yml"
	out := "dist"
	formats := "html,json,txt,md"
	themePath := ""

	pos := []string{}
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch a {
		case "--out", "-o":
			i++
			if i >= len(args) {
				die("--out requires value")
			}
			out = args[i]
		case "--formats", "-f":
			i++
			if i >= len(args) {
				die("--formats requires value")
			}
			formats = args[i]
		case "--theme", "-t":
			i++
			if i >= len(args) {
				die("--theme requires value")
			}
			themePath = args[i]
		default:
			if strings.HasPrefix(a, "--") {
				die("unknown flag: " + a)
			}
			pos = append(pos, a)
		}
	}
	if len(pos) > 0 {
		file = pos[0]
	}

	r, err := parser.Parse(file)
	if err != nil {
		die(err.Error())
	}
	for _, w := range parser.Warnings(r) {
		fmt.Fprintln(os.Stderr, "warn: "+w)
	}
	if errs := parser.Validate(r); len(errs) > 0 {
		for _, e := range errs {
			fmt.Fprintln(os.Stderr, "error: "+e)
		}
		os.Exit(1)
	}

	if err := os.MkdirAll(out, 0755); err != nil {
		die(err.Error())
	}

	// Resolve theme: local path or GitHub URL
	resolvedThemePath, err := resolveTheme(themePath)
	if err != nil {
		die(err.Error())
	}

	base := outputBase(file)
	wanted := map[string]bool{}
	for _, f := range strings.Split(formats, ",") {
		wanted[strings.TrimSpace(f)] = true
	}

	// Handle stdout output
	if out == "-" {
		if wanted["html"] {
			b, err := compiler.ToHTML(r, resolvedThemePath)
			if err != nil {
				die("html: " + err.Error())
			}
			os.Stdout.Write(b)
		}
		return
	}

	if wanted["html"] {
		b, err := compiler.ToHTML(r, resolvedThemePath)
		if err != nil {
			die("html: " + err.Error())
		}
		write(filepath.Join(out, base+".html"), b)
		// also emit index.html for GitHub Pages convenience
		write(filepath.Join(out, "index.html"), b)
		// copy theme assets if custom theme
		if themePath != "" {
			copyThemeAssets(themePath, out)
		}
	}
	if wanted["json"] {
		b, err := compiler.ToJSON(r)
		if err != nil {
			die("json: " + err.Error())
		}
		write(filepath.Join(out, base+".json"), b)
	}
	if wanted["txt"] {
		write(filepath.Join(out, base+".txt"), compiler.ToATS(r))
	}
	if wanted["md"] {
		write(filepath.Join(out, base+".md"), compiler.ToMarkdown(r))
	}
	fmt.Printf("built %s → %s/\n", file, out)
}

func outputBase(file string) string {
	name := filepath.Base(file)
	name = strings.TrimSuffix(name, filepath.Ext(name))
	name = strings.TrimSuffix(name, ".resume")
	return name
}

func write(path string, data []byte) {
	if err := os.WriteFile(path, data, 0644); err != nil {
		die(err.Error())
	}
	fmt.Printf("  wrote %s (%d bytes)\n", path, len(data))
}

func copyThemeAssets(themePath, out string) {
	assetsDir := filepath.Join(themePath, "assets")
	if _, err := os.Stat(assetsDir); err != nil {
		return
	}
	files, _ := os.ReadDir(assetsDir)
	for _, f := range files {
		if f.IsDir() {
			continue
		}
		src := filepath.Join(assetsDir, f.Name())
		dst := filepath.Join(out, f.Name())
		data, err := os.ReadFile(src)
		if err != nil {
			continue
		}
		if err := os.WriteFile(dst, data, 0644); err != nil {
			continue
		}
		fmt.Printf("  wrote %s (%d bytes)\n", dst, len(data))
	}
}

func resolveTheme(themePath string) (string, error) {
	if themePath == "" {
		return "", nil
	}

	// Check if it's a GitHub URL
	if strings.HasPrefix(themePath, "http://") || strings.HasPrefix(themePath, "https://") {
		return cloneThemeFromURL(themePath)
	}

	// Check if it's a short github.com reference
	if strings.HasPrefix(themePath, "github.com/") || strings.HasPrefix(themePath, "github.com/") {
		themePath = "https://" + themePath
		return cloneThemeFromURL(themePath)
	}

	// Otherwise treat as local path
	if _, err := os.Stat(themePath); err != nil {
		return "", fmt.Errorf("theme not found: %s", themePath)
	}
	return themePath, nil
}

func cloneThemeFromURL(themeURL string) (string, error) {
	parsed, err := url.Parse(themeURL)
	if err != nil {
		return "", err
	}

	// Parse owner/repo/theme or owner/repo from path
	// github.com/owner/repo or github.com/owner/repo/theme
	path := strings.Trim(parsed.Path, "/")
	parts := strings.Split(path, "/")
	if len(parts) < 2 {
		return "", fmt.Errorf("invalid GitHub URL: %s (use github.com/owner/repo or github.com/owner/repo/theme)", themeURL)
	}

	owner := parts[0]
	repo := parts[1]
	themeName := "default"
	if len(parts) >= 3 && parts[2] != "tree" {
		themeName = parts[2]
	}

	// Build proper repo URL
	repoURL := fmt.Sprintf("https://%s/%s/%s.git", parsed.Host, owner, repo)

	// Clone the repo to temp dir
	tmpDir, err := os.MkdirTemp("", "resumelang-theme-")
	if err != nil {
		return "", err
	}

	cmd := exec.Command("git", "clone", "--depth", "1", repoURL, tmpDir)
	cmd.Stderr = os.Stderr
	if out, err := cmd.CombinedOutput(); err != nil {
		os.RemoveAll(tmpDir)
		return "", fmt.Errorf("clone failed: %s", out)
	}

	// Return the theme path
	themePath := filepath.Join(tmpDir, themeName)
	if _, err := os.Stat(themePath); err != nil {
		// Try in themes folder
		themePath = filepath.Join(tmpDir, "themes", themeName)
		if _, err := os.Stat(themePath); err != nil {
			os.RemoveAll(tmpDir)
			return "", fmt.Errorf("theme '%s' not found in repo", themeName)
		}
	}

	fmt.Printf("  downloaded theme from GitHub\n")
	return themePath, nil
}
