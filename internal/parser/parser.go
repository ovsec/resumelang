package parser

import (
	"fmt"
	"os"
	"strings"

	"github.com/ovsec/resumelang/internal/schema"
	"gopkg.in/yaml.v3"
)

func Parse(path string) (*schema.Resume, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	return ParseBytes(data)
}

func ParseBytes(data []byte) (*schema.Resume, error) {
	var r schema.Resume
	if err := yaml.Unmarshal(data, &r); err != nil {
		return nil, fmt.Errorf("parse yaml: %w", err)
	}
	ApplyDefaults(&r)
	return &r, nil
}

func Marshal(r *schema.Resume) ([]byte, error) {
	return yaml.Marshal(r)
}

// Validate returns blocking errors. Use Warnings for non-blocking advisories.
func Validate(r *schema.Resume) []string {
	var errs []string
	if r.Resumelang != "" && r.Resumelang != schema.CurrentSpec {
		errs = append(errs, fmt.Sprintf("resumelang spec %q not supported by this CLI (expected %q)", r.Resumelang, schema.CurrentSpec))
	}
	if strings.TrimSpace(r.Person.Name) == "" {
		errs = append(errs, "person.name is required")
	}
	// theme: any folder under ./themes/<name> with templates/resume.hbs is valid.
	// validation deferred to compile time so users can ship custom themes freely.
	if r.Meta.PageSize != "" {
		switch r.Meta.PageSize {
		case "a4", "letter":
		default:
			errs = append(errs, fmt.Sprintf("meta.page_size %q invalid (a4|letter)", r.Meta.PageSize))
		}
	}
	for i, j := range r.Experience {
		if j.Company == "" {
			errs = append(errs, fmt.Sprintf("experience[%d].company required", i))
		}
		if j.Role == "" {
			errs = append(errs, fmt.Sprintf("experience[%d].role required", i))
		}
	}
	for i, e := range r.Education {
		if e.Institution == "" {
			errs = append(errs, fmt.Sprintf("education[%d].institution required", i))
		}
	}
	return errs
}

// Warnings returns non-blocking advisories. Older files without `resumelang:`
// still compile, but get nudged to add it.
func Warnings(r *schema.Resume) []string {
	var ws []string
	if r.Resumelang == "" {
		ws = append(ws, fmt.Sprintf("missing top-level `resumelang: %s` — recommended for forward compatibility", schema.CurrentSpec))
	}
	return ws
}

func ApplyDefaults(r *schema.Resume) {
	if r.Meta.Theme == "" {
		r.Meta.Theme = "minimal"
	}
	if r.Meta.Language == "" {
		r.Meta.Language = "en"
	}
	if r.Meta.Color == "" {
		r.Meta.Color = "#6366f1"
	}
	if r.Meta.Font == "" {
		r.Meta.Font = "inter"
	}
	if r.Meta.PageSize == "" {
		r.Meta.PageSize = "a4"
	}
	if len(r.Meta.Sections) == 0 {
		r.Meta.Sections = schema.DefaultSections()
	}
}
