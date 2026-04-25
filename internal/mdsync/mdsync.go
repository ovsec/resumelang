// Package mdsync converts between resume markdown and the schema IR.
//
// Markdown conventions (see CLAUDE.md "Resume markdown conventions"):
//
//	# Name                       → person.name
//	**Title line**               → person.title
//	## Summary / ## Experience…  → section markers
//	### Role @ Company           → experience entry
//	`2021` – `Present`           → start/end dates
//	> tag · tag · tag            → tags (blockquote)
//	**Category:** a · b · c      → skills group
//	- bullet                     → highlight
package mdsync

import (
	"regexp"
	"strings"

	"github.com/ovsec/resumelang/internal/compiler"
	"github.com/ovsec/resumelang/internal/parser"
	"github.com/ovsec/resumelang/internal/schema"
)

// FromMarkdown parses resume markdown into a schema.Resume.
func FromMarkdown(md string) (*schema.Resume, error) {
	r := &schema.Resume{}
	parser.ApplyDefaults(r)

	lines := strings.Split(md, "\n")
	var section string
	var curJob *schema.Job
	var curEdu *schema.Education
	var curProj *schema.Project
	var summaryBuf []string

	flush := func() {
		if curJob != nil {
			r.Experience = append(r.Experience, *curJob)
			curJob = nil
		}
		if curEdu != nil {
			r.Education = append(r.Education, *curEdu)
			curEdu = nil
		}
		if curProj != nil {
			r.Projects = append(r.Projects, *curProj)
			curProj = nil
		}
	}

	dateRe := regexp.MustCompile("`([^`]*)`\\s*[–-]\\s*`([^`]*)`")
	roleRe := regexp.MustCompile(`^###\s+(.+?)\s+@\s+(.+)$`)
	skillRe := regexp.MustCompile(`^\*\*(.+?):\*\*\s+(.+)$`)

	for _, raw := range lines {
		line := strings.TrimRight(raw, " \t\r")
		trim := strings.TrimSpace(line)

		switch {
		case strings.HasPrefix(line, "# ") && r.Person.Name == "":
			r.Person.Name = strings.TrimSpace(strings.TrimPrefix(line, "# "))

		case strings.HasPrefix(line, "## "):
			flush()
			section = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(line, "## ")))
			if section == "summary" {
				summaryBuf = nil
			}

		case strings.HasPrefix(line, "### "):
			flush()
			m := roleRe.FindStringSubmatch(line)
			switch section {
			case "experience":
				j := schema.Job{}
				if len(m) == 3 {
					j.Role = m[1]
					j.Company = m[2]
				} else {
					j.Role = strings.TrimPrefix(line, "### ")
				}
				curJob = &j
			case "education":
				e := schema.Education{}
				if len(m) == 3 {
					e.Degree = m[1]
					e.Institution = m[2]
				} else {
					e.Institution = strings.TrimPrefix(line, "### ")
				}
				curEdu = &e
			case "projects":
				p := schema.Project{}
				name := strings.TrimPrefix(line, "### ")
				if strings.HasPrefix(name, "[") {
					if idx := strings.Index(name, "]("); idx > 0 {
						p.Name = strings.TrimPrefix(name[:idx], "[")
						p.URL = strings.TrimSuffix(name[idx+2:], ")")
					}
				} else {
					p.Name = name
				}
				curProj = &p
			}

		case dateRe.MatchString(line):
			m := dateRe.FindStringSubmatch(line)
			start, end := m[1], m[2]
			if strings.EqualFold(end, "Present") {
				end = ""
			}
			switch {
			case curJob != nil:
				curJob.Start = start
				curJob.End = end
				if rest := strings.TrimSpace(dateRe.ReplaceAllString(line, "")); rest != "" {
					curJob.Location = strings.TrimLeft(strings.Trim(rest, "·- "), "· ")
				}
			case curEdu != nil:
				curEdu.Start = start
				curEdu.End = end
			}

		case strings.HasPrefix(trim, "> "):
			tags := splitDot(strings.TrimPrefix(trim, "> "))
			switch {
			case curJob != nil:
				curJob.Tags = tags
			case curProj != nil:
				curProj.Tags = tags
			}

		case section == "skills" && skillRe.MatchString(trim):
			m := skillRe.FindStringSubmatch(trim)
			r.Skills = append(r.Skills, schema.SkillGroup{
				Category: m[1],
				Skills:   splitDot(m[2]),
			})

		case strings.HasPrefix(trim, "- "):
			item := strings.TrimPrefix(trim, "- ")
			switch section {
			case "experience":
				if curJob != nil {
					curJob.Highlights = append(curJob.Highlights, item)
				}
			case "projects":
				if curProj != nil {
					curProj.Highlights = append(curProj.Highlights, item)
				}
			case "languages":
				name, prof := splitLang(item)
				r.Languages = append(r.Languages, schema.Language{Name: name, Proficiency: prof})
			case "certifications":
				r.Certifications = append(r.Certifications, parseCert(item))
			case "awards":
				r.Awards = append(r.Awards, parseAward(item))
			}

		case section == "summary" && trim != "":
			summaryBuf = append(summaryBuf, trim)

		case section == "experience" && trim != "" && curJob != nil && curJob.Description == "":
			if !strings.HasPrefix(trim, "**") && !strings.HasPrefix(trim, "`") && !strings.HasPrefix(trim, ">") {
				curJob.Description = trim
			}

		case section == "" && strings.HasPrefix(trim, "**") && strings.HasSuffix(trim, "**") && r.Person.Title == "":
			r.Person.Title = strings.TrimSuffix(strings.TrimPrefix(trim, "**"), "**")
		}
	}
	flush()
	if len(summaryBuf) > 0 {
		r.Summary = strings.Join(summaryBuf, " ")
	}
	parser.ApplyDefaults(r)
	return r, nil
}

// ToMarkdown is a thin wrapper over compiler.ToMarkdown for symmetry.
func ToMarkdown(r *schema.Resume) string {
	return string(compiler.ToMarkdown(r))
}

func splitDot(s string) []string {
	parts := strings.Split(s, "·")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func splitLang(s string) (string, string) {
	s = strings.TrimPrefix(s, "**")
	if idx := strings.Index(s, "**"); idx >= 0 {
		name := s[:idx]
		rest := strings.TrimPrefix(s[idx+2:], " — ")
		return strings.TrimSpace(name), strings.TrimSpace(rest)
	}
	if parts := strings.SplitN(s, " — ", 2); len(parts) == 2 {
		return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
	}
	return strings.TrimSpace(s), ""
}

func parseCert(s string) schema.Certification {
	c := schema.Certification{}
	rest := s
	if i := strings.LastIndex(rest, "("); i > 0 && strings.HasSuffix(rest, ")") {
		c.Date = strings.TrimSuffix(rest[i+1:], ")")
		rest = strings.TrimSpace(rest[:i])
	}
	if parts := strings.SplitN(rest, " — ", 2); len(parts) == 2 {
		c.Name = strings.TrimSpace(parts[0])
		c.Issuer = strings.TrimSpace(parts[1])
	} else {
		c.Name = strings.TrimSpace(rest)
	}
	return c
}

func parseAward(s string) schema.Award {
	a := schema.Award{}
	rest := s
	if i := strings.LastIndex(rest, "("); i > 0 && strings.HasSuffix(rest, ")") {
		a.Date = strings.TrimSuffix(rest[i+1:], ")")
		rest = strings.TrimSpace(rest[:i])
	}
	if parts := strings.SplitN(rest, " — ", 2); len(parts) == 2 {
		a.Title = strings.TrimSpace(parts[0])
		a.Awarder = strings.TrimSpace(parts[1])
	} else {
		a.Title = strings.TrimSpace(rest)
	}
	return a
}
