package compiler

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/aymerick/raymond"
	"github.com/ovsec/resumelang/internal/schema"
	"gopkg.in/yaml.v3"
)

type ThemeInfo struct {
	Spec     string         `yaml:"spec"`
	Name     string         `yaml:"name"`
	Version  string         `yaml:"version"`
	Author   string         `yaml:"author"`
	Tokens   map[string]any `yaml:"tokens"`
	Supports map[string]any `yaml:"supports"`
}

func ToHTML(r *schema.Resume, themePath string) ([]byte, error) {
	if themePath == "" {
		name := r.Meta.Theme
		if name == "" {
			name = "sap"
		}
		themePath = filepath.Join("themes", name)
		if _, err := os.Stat(themePath); err != nil {
			themePath = filepath.Join("themes", "sap")
		}
	}

	tmplPath := filepath.Join(themePath, "templates", "resume.hbs")
	tmplData, err := os.ReadFile(tmplPath)
	if err != nil {
		return nil, fmt.Errorf("read template: %w", err)
	}

	cssPath := filepath.Join(themePath, "assets", "style.css")
	cssData, _ := os.ReadFile(cssPath)

	theme, _ := loadThemeYML(filepath.Join(themePath, "theme.yml"))
	merged := mergeTokens(theme.Tokens, r.Meta.Tokens)
	tokens := flattenTokens(merged)

	ctx, err := buildContext(r, tokens, string(cssData))
	if err != nil {
		return nil, err
	}

	tpl, err := raymond.Parse(string(tmplData))
	if err != nil {
		return nil, fmt.Errorf("parse hbs: %w", err)
	}
	registerHelpers(tpl)

	out, err := tpl.Exec(ctx)
	if err != nil {
		return nil, fmt.Errorf("exec hbs: %w", err)
	}
	return []byte(out), nil
}

func ThemeNames() []string {
	entries, err := os.ReadDir("themes")
	if err != nil {
		return []string{"minimal"}
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() {
			if _, err := os.Stat(filepath.Join("themes", e.Name(), "templates", "resume.hbs")); err == nil {
				names = append(names, e.Name())
			}
		}
	}
	if len(names) == 0 {
		names = append(names, "minimal")
	}
	return names
}

func buildContext(r *schema.Resume, tokens map[string]any, themeCSS string) (map[string]any, error) {
	raw, err := json.Marshal(r)
	if err != nil {
		return nil, err
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, err
	}
	data["tokens"] = tokens
	data["themeCSS"] = themeCSS
	return data, nil
}

func loadThemeYML(path string) (ThemeInfo, error) {
	var t ThemeInfo
	data, err := os.ReadFile(path)
	if err != nil {
		return t, err
	}
	return t, yaml.Unmarshal(data, &t)
}

// mergeTokens deep-merges user tokens onto theme defaults. Map values are
// merged recursively; everything else (scalars, slices) is overwritten.
func mergeTokens(base, override map[string]any) map[string]any {
	out := make(map[string]any, len(base))
	for k, v := range base {
		out[k] = v
	}
	for k, v := range override {
		bv, exists := out[k]
		if !exists {
			out[k] = normalizeTokenValue(v)
			continue
		}
		bm, baseIsMap := asStringMap(bv)
		om, overIsMap := asStringMap(v)
		if baseIsMap && overIsMap {
			out[k] = mergeTokens(bm, om)
			continue
		}
		out[k] = normalizeTokenValue(v)
	}
	return out
}

func asStringMap(v any) (map[string]any, bool) {
	if m, ok := v.(map[string]any); ok {
		return m, true
	}
	if m, ok := v.(map[any]any); ok {
		out := make(map[string]any, len(m))
		for k, vv := range m {
			if ks, ok := k.(string); ok {
				out[ks] = vv
			}
		}
		return out, true
	}
	return nil, false
}

func normalizeTokenValue(v any) any {
	if m, ok := asStringMap(v); ok {
		out := make(map[string]any, len(m))
		for k, vv := range m {
			out[k] = normalizeTokenValue(vv)
		}
		return out
	}
	return v
}

func flattenTokens(tokens map[string]any) map[string]any {
	flat := make(map[string]any)
	var walk func(prefix string, src map[string]any)
	walk = func(prefix string, src map[string]any) {
		for k, v := range src {
			key := k
			if prefix != "" {
				key = prefix + "_" + k
			}
			if sub, ok := v.(map[string]any); ok {
				walk(key, sub)
				continue
			}
			if sub, ok := v.(map[any]any); ok {
				m := make(map[string]any, len(sub))
				for k2, v2 := range sub {
					if ks, ok := k2.(string); ok {
						m[ks] = v2
					}
				}
				walk(key, m)
				continue
			}
			flat[key] = v
		}
	}
	walk("", tokens)
	return flat
}

func registerHelpers(tpl *raymond.Template) {
	tpl.RegisterHelper("join", func(arr []any, sep string) string {
		parts := make([]string, 0, len(arr))
		for _, v := range arr {
			parts = append(parts, fmt.Sprint(v))
		}
		return strings.Join(parts, sep)
	})
	tpl.RegisterHelper("default", func(v any, fallback string) string {
		s := fmt.Sprint(v)
		if s == "" || v == nil {
			return fallback
		}
		return s
	})
	tpl.RegisterHelper("eq", func(a, b any) bool {
		return fmt.Sprint(a) == fmt.Sprint(b)
	})
	tpl.RegisterHelper("upper", strings.ToUpper)
	tpl.RegisterHelper("lower", strings.ToLower)
}
