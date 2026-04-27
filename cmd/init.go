package cmd

import (
	"fmt"
	"os"
)

const starter = `# yaml-language-server: $schema=https://resumelang.dev/schema/v1.json
resumelang: v1

meta:
  theme: sap        # sap | minimal | aurora | material | terminal | <custom>
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
  name: Your Name
  title: Your Title
  email: you@example.com
  phone: ""
  location: City, Country
  website: ""
  github: ""
  linkedin: ""

summary: |
  One paragraph about you.

experience:
  - company: Acme Corp
    role: Senior Engineer
    location: Remote
    start: "2022"
    end: ""
    description: What you did here.
    highlights:
      - Shipped X
      - Improved Y by Z%
    tags: [Go, Postgres]

education:
  - institution: Some University
    degree: BSc
    field: Computer Science
    start: "2015"
    end: "2019"

skills:
  - category: Languages
    skills: [Go, TypeScript]
  - category: Infrastructure
    skills: [Kubernetes, AWS]

projects:
  - name: example-project
    description: Short pitch.
    url: https://github.com/you/example
    highlights:
      - Cool thing 1
    tags: [Go]

certifications: []

languages:
  - name: English
    proficiency: native
`

func Init(args []string) {
	file := "resume.yml"
	if len(args) > 0 {
		file = args[0]
	}
	if _, err := os.Stat(file); err == nil {
		die(file + " already exists")
	}
	if err := os.WriteFile(file, []byte(starter), 0644); err != nil {
		die(err.Error())
	}
	fmt.Printf("created %s\n", file)
	fmt.Println("next: edit it, then run `resumelang build`")
}
