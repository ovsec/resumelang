package compiler

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/ovsec/resumelang/internal/schema"
)

func ToJSON(r *schema.Resume) ([]byte, error) {
	return json.MarshalIndent(jsonResume(r), "", "  ")
}

func ToATS(r *schema.Resume) []byte {
	var b strings.Builder
	line := func(s string) { b.WriteString(s); b.WriteByte('\n') }
	hr := func() { line(strings.Repeat("-", 60)) }

	line(strings.ToUpper(r.Person.Name))
	if r.Person.Title != "" {
		line(r.Person.Title)
	}
	var contact []string
	for _, v := range []string{r.Person.Email, r.Person.Phone, r.Person.Location, r.Person.Website} {
		if v != "" {
			contact = append(contact, v)
		}
	}
	if len(contact) > 0 {
		line(strings.Join(contact, " | "))
	}
	line("")

	for _, sec := range r.Meta.Sections {
		switch sec {
		case "summary":
			if r.Summary == "" {
				continue
			}
			hr()
			line("SUMMARY")
			hr()
			line(strings.TrimSpace(r.Summary))
			line("")
		case "experience":
			if len(r.Experience) == 0 {
				continue
			}
			hr()
			line("EXPERIENCE")
			hr()
			for _, j := range r.Experience {
				end := j.End
				if end == "" {
					end = "Present"
				}
				line(fmt.Sprintf("%s — %s (%s–%s)", j.Role, j.Company, j.Start, end))
				if j.Location != "" {
					line(j.Location)
				}
				if j.Description != "" {
					line(j.Description)
				}
				for _, h := range j.Highlights {
					line("- " + h)
				}
				if len(j.Tags) > 0 {
					line("Tech: " + strings.Join(j.Tags, ", "))
				}
				line("")
			}
		case "education":
			if len(r.Education) == 0 {
				continue
			}
			hr()
			line("EDUCATION")
			hr()
			for _, e := range r.Education {
				deg := strings.TrimSpace(e.Degree + " " + e.Field)
				line(fmt.Sprintf("%s — %s (%s–%s)", deg, e.Institution, e.Start, e.End))
				if e.GPA != "" {
					line("GPA: " + e.GPA)
				}
				line("")
			}
		case "skills":
			if len(r.Skills) == 0 {
				continue
			}
			hr()
			line("SKILLS")
			hr()
			for _, g := range r.Skills {
				line(g.Category + ": " + strings.Join(g.Skills, ", "))
			}
			line("")
		case "projects":
			if len(r.Projects) == 0 {
				continue
			}
			hr()
			line("PROJECTS")
			hr()
			for _, p := range r.Projects {
				line(p.Name)
				if p.Description != "" {
					line(p.Description)
				}
				for _, h := range p.Highlights {
					line("- " + h)
				}
				if p.URL != "" {
					line(p.URL)
				}
				line("")
			}
		case "certifications":
			if len(r.Certifications) == 0 {
				continue
			}
			hr()
			line("CERTIFICATIONS")
			hr()
			for _, c := range r.Certifications {
				s := c.Name
				if c.Issuer != "" {
					s += " — " + c.Issuer
				}
				if c.Date != "" {
					s += " (" + c.Date + ")"
				}
				line(s)
			}
			line("")
		case "languages":
			if len(r.Languages) == 0 {
				continue
			}
			hr()
			line("LANGUAGES")
			hr()
			for _, l := range r.Languages {
				line(l.Name + " — " + l.Proficiency)
			}
			line("")
		case "publications":
			if len(r.Publications) == 0 {
				continue
			}
			hr()
			line("PUBLICATIONS")
			hr()
			for _, p := range r.Publications {
				s := p.Title
				if p.Publisher != "" {
					s += " — " + p.Publisher
				}
				if p.Date != "" {
					s += " (" + p.Date + ")"
				}
				line(s)
			}
			line("")
		case "awards":
			if len(r.Awards) == 0 {
				continue
			}
			hr()
			line("AWARDS")
			hr()
			for _, a := range r.Awards {
				s := a.Title
				if a.Awarder != "" {
					s += " — " + a.Awarder
				}
				if a.Date != "" {
					s += " (" + a.Date + ")"
				}
				line(s)
			}
			line("")
		case "volunteer":
			if len(r.Volunteer) == 0 {
				continue
			}
			hr()
			line("VOLUNTEER")
			hr()
			for _, v := range r.Volunteer {
				end := v.End
				if end == "" {
					end = "Present"
				}
				line(fmt.Sprintf("%s — %s (%s–%s)", v.Role, v.Organization, v.Start, end))
				if v.Description != "" {
					line(v.Description)
				}
				for _, h := range v.Highlights {
					line("- " + h)
				}
				line("")
			}
		}
	}
	return []byte(b.String())
}

func ToMarkdown(r *schema.Resume) []byte {
	var b strings.Builder
	w := func(format string, args ...any) { fmt.Fprintf(&b, format, args...) }

	w("# %s\n\n", r.Person.Name)
	if r.Person.Title != "" {
		w("**%s**\n\n", r.Person.Title)
	}
	var contact []string
	if r.Person.Email != "" {
		contact = append(contact, r.Person.Email)
	}
	if r.Person.Phone != "" {
		contact = append(contact, r.Person.Phone)
	}
	if r.Person.Location != "" {
		contact = append(contact, r.Person.Location)
	}
	if r.Person.Website != "" {
		contact = append(contact, fmt.Sprintf("[%s](%s)", r.Person.Website, r.Person.Website))
	}
	if r.Person.GitHub != "" {
		contact = append(contact, fmt.Sprintf("[github/%s](https://github.com/%s)", r.Person.GitHub, r.Person.GitHub))
	}
	if r.Person.LinkedIn != "" {
		contact = append(contact, fmt.Sprintf("[linkedin/%s](https://linkedin.com/in/%s)", r.Person.LinkedIn, r.Person.LinkedIn))
	}
	if len(contact) > 0 {
		w("%s\n\n", strings.Join(contact, " · "))
	}

	for _, sec := range r.Meta.Sections {
		switch sec {
		case "summary":
			if r.Summary == "" {
				continue
			}
			w("## Summary\n\n%s\n\n", strings.TrimSpace(r.Summary))
		case "experience":
			if len(r.Experience) == 0 {
				continue
			}
			w("## Experience\n\n")
			for _, j := range r.Experience {
				end := j.End
				if end == "" {
					end = "Present"
				}
				w("### %s @ %s\n", j.Role, j.Company)
				w("`%s` – `%s`", j.Start, end)
				if j.Location != "" {
					w(" · %s", j.Location)
				}
				w("\n\n")
				if j.Description != "" {
					w("%s\n\n", j.Description)
				}
				for _, h := range j.Highlights {
					w("- %s\n", h)
				}
				if len(j.Tags) > 0 {
					w("\n> %s\n", strings.Join(j.Tags, " · "))
				}
				w("\n")
			}
		case "education":
			if len(r.Education) == 0 {
				continue
			}
			w("## Education\n\n")
			for _, e := range r.Education {
				deg := strings.TrimSpace(e.Degree + " " + e.Field)
				w("### %s @ %s\n", deg, e.Institution)
				w("`%s` – `%s`\n\n", e.Start, e.End)
				if e.GPA != "" {
					w("GPA: %s\n\n", e.GPA)
				}
			}
		case "skills":
			if len(r.Skills) == 0 {
				continue
			}
			w("## Skills\n\n")
			for _, g := range r.Skills {
				w("**%s:** %s\n\n", g.Category, strings.Join(g.Skills, " · "))
			}
		case "projects":
			if len(r.Projects) == 0 {
				continue
			}
			w("## Projects\n\n")
			for _, p := range r.Projects {
				if p.URL != "" {
					w("### [%s](%s)\n", p.Name, p.URL)
				} else {
					w("### %s\n", p.Name)
				}
				if p.Description != "" {
					w("%s\n\n", p.Description)
				}
				for _, h := range p.Highlights {
					w("- %s\n", h)
				}
				if len(p.Tags) > 0 {
					w("\n> %s\n", strings.Join(p.Tags, " · "))
				}
				w("\n")
			}
		case "certifications":
			if len(r.Certifications) == 0 {
				continue
			}
			w("## Certifications\n\n")
			for _, c := range r.Certifications {
				line := "- " + c.Name
				if c.Issuer != "" {
					line += " — " + c.Issuer
				}
				if c.Date != "" {
					line += " (" + c.Date + ")"
				}
				w("%s\n", line)
			}
			w("\n")
		case "languages":
			if len(r.Languages) == 0 {
				continue
			}
			w("## Languages\n\n")
			for _, l := range r.Languages {
				w("- **%s** — %s\n", l.Name, l.Proficiency)
			}
			w("\n")
		case "awards":
			if len(r.Awards) == 0 {
				continue
			}
			w("## Awards\n\n")
			for _, a := range r.Awards {
				line := "- " + a.Title
				if a.Awarder != "" {
					line += " — " + a.Awarder
				}
				if a.Date != "" {
					line += " (" + a.Date + ")"
				}
				w("%s\n", line)
			}
			w("\n")
		}
	}
	return []byte(b.String())
}

func jsonResume(r *schema.Resume) map[string]any {
	basics := map[string]any{
		"name":     r.Person.Name,
		"label":    r.Person.Title,
		"email":    r.Person.Email,
		"phone":    r.Person.Phone,
		"website":  r.Person.Website,
		"summary":  r.Summary,
		"location": map[string]any{"address": r.Person.Location},
	}
	var profiles []map[string]any
	if r.Person.GitHub != "" {
		profiles = append(profiles, map[string]any{
			"network":  "GitHub",
			"username": r.Person.GitHub,
			"url":      "https://github.com/" + r.Person.GitHub,
		})
	}
	if r.Person.LinkedIn != "" {
		profiles = append(profiles, map[string]any{
			"network":  "LinkedIn",
			"username": r.Person.LinkedIn,
			"url":      "https://linkedin.com/in/" + r.Person.LinkedIn,
		})
	}
	basics["profiles"] = profiles

	work := make([]map[string]any, 0, len(r.Experience))
	for _, j := range r.Experience {
		work = append(work, map[string]any{
			"name":       j.Company,
			"position":   j.Role,
			"location":   j.Location,
			"url":        j.URL,
			"startDate":  j.Start,
			"endDate":    j.End,
			"summary":    j.Description,
			"highlights": j.Highlights,
			"keywords":   j.Tags,
		})
	}
	edu := make([]map[string]any, 0, len(r.Education))
	for _, e := range r.Education {
		edu = append(edu, map[string]any{
			"institution": e.Institution,
			"area":        e.Field,
			"studyType":   e.Degree,
			"startDate":   e.Start,
			"endDate":     e.End,
			"score":       e.GPA,
			"url":         e.URL,
		})
	}
	skills := make([]map[string]any, 0, len(r.Skills))
	for _, g := range r.Skills {
		skills = append(skills, map[string]any{
			"name":     g.Category,
			"keywords": g.Skills,
		})
	}
	projects := make([]map[string]any, 0, len(r.Projects))
	for _, p := range r.Projects {
		projects = append(projects, map[string]any{
			"name":        p.Name,
			"description": p.Description,
			"url":         p.URL,
			"highlights":  p.Highlights,
			"keywords":    p.Tags,
		})
	}
	return map[string]any{
		"basics":    basics,
		"work":      work,
		"education": edu,
		"skills":    skills,
		"projects":  projects,
		"meta": map[string]any{
			"theme":    r.Meta.Theme,
			"language": r.Meta.Language,
			"version":  "v1.0.0",
		},
	}
}
