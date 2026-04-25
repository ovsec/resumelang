package schema

// CurrentSpec is the current DSL version. Resumes should declare `resumelang: v1`.
const CurrentSpec = "v1"

type Resume struct {
	Resumelang     string          `yaml:"resumelang"     json:"resumelang,omitempty"`
	Meta           Meta            `yaml:"meta"           json:"meta"`
	Person         Person          `yaml:"person"         json:"person"`
	Summary        string          `yaml:"summary"        json:"summary,omitempty"`
	Experience     []Job           `yaml:"experience"     json:"experience,omitempty"`
	Education      []Education     `yaml:"education"      json:"education,omitempty"`
	Skills         []SkillGroup    `yaml:"skills"         json:"skills,omitempty"`
	Projects       []Project       `yaml:"projects"       json:"projects,omitempty"`
	Publications   []Publication   `yaml:"publications"   json:"publications,omitempty"`
	Certifications []Certification `yaml:"certifications" json:"certifications,omitempty"`
	Languages      []Language      `yaml:"languages"      json:"languages,omitempty"`
	Volunteer      []Volunteer     `yaml:"volunteer"      json:"volunteer,omitempty"`
	Awards         []Award         `yaml:"awards"         json:"awards,omitempty"`
	Custom         []Section       `yaml:"custom"         json:"custom,omitempty"`
}

type Meta struct {
	Theme    string   `yaml:"theme"     json:"theme,omitempty"`
	Language string   `yaml:"language"  json:"language,omitempty"`
	Color    string   `yaml:"color"     json:"color,omitempty"`
	Font     string   `yaml:"font"      json:"font,omitempty"`
	PageSize string   `yaml:"page_size" json:"page_size,omitempty"`
	Sections []string `yaml:"sections"  json:"sections,omitempty"`
}

type Person struct {
	Name     string `yaml:"name"     json:"name"`
	Title    string `yaml:"title"    json:"title,omitempty"`
	Email    string `yaml:"email"    json:"email,omitempty"`
	Phone    string `yaml:"phone"    json:"phone,omitempty"`
	Location string `yaml:"location" json:"location,omitempty"`
	Website  string `yaml:"website"  json:"website,omitempty"`
	GitHub   string `yaml:"github"   json:"github,omitempty"`
	LinkedIn string `yaml:"linkedin" json:"linkedin,omitempty"`
	Avatar   string `yaml:"avatar"   json:"avatar,omitempty"`
}

type Job struct {
	Company     string   `yaml:"company"     json:"company"`
	Role        string   `yaml:"role"        json:"role"`
	Location    string   `yaml:"location"    json:"location,omitempty"`
	Start       string   `yaml:"start"       json:"start,omitempty"`
	End         string   `yaml:"end"         json:"end,omitempty"`
	Description string   `yaml:"description" json:"description,omitempty"`
	Highlights  []string `yaml:"highlights"  json:"highlights,omitempty"`
	Tags        []string `yaml:"tags"        json:"tags,omitempty"`
	URL         string   `yaml:"url"         json:"url,omitempty"`
}

type Education struct {
	Institution string   `yaml:"institution" json:"institution"`
	Degree      string   `yaml:"degree"      json:"degree,omitempty"`
	Field       string   `yaml:"field"       json:"field,omitempty"`
	Location    string   `yaml:"location"    json:"location,omitempty"`
	Start       string   `yaml:"start"       json:"start,omitempty"`
	End         string   `yaml:"end"         json:"end,omitempty"`
	GPA         string   `yaml:"gpa"         json:"gpa,omitempty"`
	Highlights  []string `yaml:"highlights"  json:"highlights,omitempty"`
	URL         string   `yaml:"url"         json:"url,omitempty"`
}

type SkillGroup struct {
	Category string   `yaml:"category" json:"category"`
	Skills   []string `yaml:"skills"   json:"skills"`
}

type Project struct {
	Name        string   `yaml:"name"        json:"name"`
	Description string   `yaml:"description" json:"description,omitempty"`
	URL         string   `yaml:"url"         json:"url,omitempty"`
	GitHub      string   `yaml:"github"      json:"github,omitempty"`
	Highlights  []string `yaml:"highlights"  json:"highlights,omitempty"`
	Tags        []string `yaml:"tags"        json:"tags,omitempty"`
	Start       string   `yaml:"start"       json:"start,omitempty"`
	End         string   `yaml:"end"         json:"end,omitempty"`
}

type Publication struct {
	Title     string `yaml:"title"     json:"title"`
	Publisher string `yaml:"publisher" json:"publisher,omitempty"`
	Date      string `yaml:"date"      json:"date,omitempty"`
	URL       string `yaml:"url"       json:"url,omitempty"`
	Summary   string `yaml:"summary"   json:"summary,omitempty"`
}

type Certification struct {
	Name   string `yaml:"name"   json:"name"`
	Issuer string `yaml:"issuer" json:"issuer,omitempty"`
	Date   string `yaml:"date"   json:"date,omitempty"`
	URL    string `yaml:"url"    json:"url,omitempty"`
	ID     string `yaml:"id"     json:"id,omitempty"`
}

type Language struct {
	Name        string `yaml:"name"        json:"name"`
	Proficiency string `yaml:"proficiency" json:"proficiency,omitempty"`
}

type Volunteer struct {
	Organization string   `yaml:"organization" json:"organization"`
	Role         string   `yaml:"role"         json:"role,omitempty"`
	Start        string   `yaml:"start"        json:"start,omitempty"`
	End          string   `yaml:"end"          json:"end,omitempty"`
	Description  string   `yaml:"description"  json:"description,omitempty"`
	Highlights   []string `yaml:"highlights"   json:"highlights,omitempty"`
	URL          string   `yaml:"url"          json:"url,omitempty"`
}

type Award struct {
	Title   string `yaml:"title"   json:"title"`
	Awarder string `yaml:"awarder" json:"awarder,omitempty"`
	Date    string `yaml:"date"    json:"date,omitempty"`
	Summary string `yaml:"summary" json:"summary,omitempty"`
	URL     string `yaml:"url"     json:"url,omitempty"`
}

type Section struct {
	Title string        `yaml:"title" json:"title"`
	Items []SectionItem `yaml:"items" json:"items"`
}

type SectionItem struct {
	Title       string   `yaml:"title"       json:"title,omitempty"`
	Subtitle    string   `yaml:"subtitle"    json:"subtitle,omitempty"`
	Date        string   `yaml:"date"        json:"date,omitempty"`
	Description string   `yaml:"description" json:"description,omitempty"`
	Highlights  []string `yaml:"highlights"  json:"highlights,omitempty"`
	URL         string   `yaml:"url"         json:"url,omitempty"`
}

func DefaultSections() []string {
	return []string{
		"summary", "experience", "education", "skills",
		"projects", "publications", "certifications",
		"languages", "volunteer", "awards",
	}
}
