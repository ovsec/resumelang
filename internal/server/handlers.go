package server

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/ovsec/resumelang/internal/compiler"
	"github.com/ovsec/resumelang/internal/parser"
)

// ── Pages ──────────────────────────────────────────────────────────

func pageLanding(c *fiber.Ctx) error {
	user, ok := sessionUser(c)
	data := fiber.Map{
		"Themes":    themeNames(),
		"Providers": providerList(),
	}
	if ok {
		data["User"] = user
	}
	return c.Render("landing", data, "layout_landing")
}

func pageEditor(c *fiber.Ctx) error {
	user, _ := sessionUser(c)
	return c.Render("editor", fiber.Map{
		"Title":  "resumelang — editor",
		"Themes": themeNames(),
		"User":   user,
	})
}

func pageView(c *fiber.Ctx) error {
	user, loggedIn := sessionUser(c)
	data := fiber.Map{
		"Title":    "resumelang — view",
		"ViewPage": true,
	}
	if loggedIn {
		data["User"] = user
	}
	return c.Render("view", data)
}

func pageLogin(c *fiber.Ctx) error {
	return c.Render("login", fiber.Map{
		"Title":     "Sign in — resumelang",
		"Providers": providerList(),
		"Next":      c.Query("next", "/editor"),
	})
}

func pageDashboard(c *fiber.Ctx) error {
	user, _ := sessionUser(c)
	uid := user.Provider + "-" + user.ID
	resumes, _ := globalStore.List(uid)
	return c.Render("dashboard", fiber.Map{
		"Title":   user.Name + " — resumelang",
		"User":    user,
		"Resumes": resumes,
	})
}

// ── HTMX Partials ─────────────────────────────────────────────────

func partialShareModal(c *fiber.Ctx) error {
	user, loggedIn := sessionUser(c)
	data := fiber.Map{
		"LoggedIn": loggedIn,
		"User":     user,
	}
	if resumeID := c.Query("resume_id"); resumeID != "" && loggedIn {
		uid := user.Provider + "-" + user.ID
		list, err := globalStore.List(uid)
		if err == nil {
			for _, r := range list {
				if r.ID == resumeID {
					data["PreloadYAML"] = r.YAML
					data["ResumeID"] = resumeID
					break
				}
			}
		}
	}
	return c.Render("partials/share_modal", data, "")
}

func partialGallery(c *fiber.Ctx) error {
	return c.Render("partials/gallery", fiber.Map{
		"Themes": themeNames(),
	}, "")
}

func partialGalleryCard(c *fiber.Ctx) error {
	theme := c.Params("theme")
	yaml := c.FormValue("yaml")
	if yaml == "" {
		return c.SendString(`<div class="gallery-card-err">no yaml</div>`)
	}
	r, err := parser.ParseBytes([]byte(yaml))
	if err != nil {
		return c.SendString(fmt.Sprintf(`<div class="gallery-card-err">%v</div>`, err))
	}
	r.Meta.Theme = theme
	html, err := compiler.ToHTML(r, "")
	if err != nil {
		return c.SendString(fmt.Sprintf(`<div class="gallery-card-err">%v</div>`, err))
	}
	return c.Render("partials/gallery_card", fiber.Map{
		"Theme": theme,
		"HTML":  string(html),
	}, "")
}

// ── API ────────────────────────────────────────────────────────────

func apiDefaultYAML(c *fiber.Ctx) error {
	// 1. resume.yml in cwd (user's own file)
	// 2. examples/sap-consultant.resume.yml (canonical starter)
	// 3. any other *.yml in examples/
	// 4. 204 → client falls back to hardcoded stub
	candidates := []string{
		"resume.yml",
		filepath.Join("examples", "sap-consultant.resume.yml"),
	}
	for _, p := range candidates {
		if data, err := os.ReadFile(p); err == nil {
			c.Set("Content-Type", "text/plain; charset=utf-8")
			return c.Send(data)
		}
	}
	if entries, err := os.ReadDir("examples"); err == nil {
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			n := e.Name()
			if strings.HasSuffix(n, ".yml") || strings.HasSuffix(n, ".yaml") {
				if data, err := os.ReadFile(filepath.Join("examples", n)); err == nil {
					c.Set("Content-Type", "text/plain; charset=utf-8")
					return c.Send(data)
				}
			}
		}
	}
	return c.SendStatus(204)
}

type renderBody struct {
	YAML  string `json:"yaml"`
	Theme string `json:"theme"`
}

func apiRender(c *fiber.Ctx) error {
	var body renderBody
	if err := c.BodyParser(&body); err != nil || body.YAML == "" {
		return c.Status(400).SendString("missing yaml")
	}
	r, err := parser.ParseBytes([]byte(body.YAML))
	if err != nil {
		return c.Status(422).SendString("YAML: " + err.Error())
	}
	if body.Theme != "" {
		r.Meta.Theme = body.Theme
	}
	html, err := compiler.ToHTML(r, "")
	if err != nil {
		return c.Status(422).SendString("render: " + err.Error())
	}
	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.Send(html)
}

func apiThemes(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{"themes": themeNames()})
}

func apiMe(c *fiber.Ctx) error {
	u, ok := sessionUser(c)
	if !ok {
		return c.JSON(fiber.Map{"user": nil, "providers": providerList()})
	}
	return c.JSON(fiber.Map{"user": u, "providers": providerList()})
}

func apiExportHTML(c *fiber.Ctx) error {
	var body renderBody
	if err := c.BodyParser(&body); err != nil || body.YAML == "" {
		return c.Status(400).SendString("missing yaml")
	}
	r, err := parser.ParseBytes([]byte(body.YAML))
	if err != nil {
		return c.Status(422).SendString("YAML: " + err.Error())
	}
	if body.Theme != "" {
		r.Meta.Theme = body.Theme
	}
	html, err := compiler.ToHTML(r, "")
	if err != nil {
		return c.Status(422).SendString("render: " + err.Error())
	}
	name := slugName(r.Person.Name)
	c.Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.html"`, name))
	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.Send(html)
}

func apiExportTxt(c *fiber.Ctx) error {
	var body struct {
		YAML string `json:"yaml"`
	}
	if err := c.BodyParser(&body); err != nil || body.YAML == "" {
		return c.Status(400).SendString("missing yaml")
	}
	r, err := parser.ParseBytes([]byte(body.YAML))
	if err != nil {
		return c.Status(422).SendString("YAML: " + err.Error())
	}
	txt := compiler.ToATS(r)
	name := slugName(r.Person.Name)
	c.Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.txt"`, name))
	c.Set("Content-Type", "text/plain; charset=utf-8")
	return c.Send(txt)
}

// ── User Resumes ───────────────────────────────────────────────────

func apiPublicResume(c *fiber.Ctx) error {
	id := c.Params("id")
	entries, err := os.ReadDir(globalStore.root)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "not found"})
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		list, err := globalStore.List(e.Name())
		if err != nil {
			continue
		}
		for _, r := range list {
			if r.ID == id {
				return c.JSON(fiber.Map{"yaml": r.YAML})
			}
		}
	}
	return c.Status(404).JSON(fiber.Map{"error": "not found"})
}

func apiListResumes(c *fiber.Ctx) error {
	user, _ := sessionUser(c)
	list, err := globalStore.List(user.Provider + "-" + user.ID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"resumes": list})
}

func apiGetResume(c *fiber.Ctx) error {
	user, _ := sessionUser(c)
	id := c.Params("id")
	list, err := globalStore.List(user.Provider + "-" + user.ID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	for _, r := range list {
		if r.ID == id {
			return c.JSON(r)
		}
	}
	return c.Status(404).JSON(fiber.Map{"error": "not found"})
}

func apiSaveResume(c *fiber.Ctx) error {
	var body struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		YAML string `json:"yaml"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid body"})
	}
	user, _ := sessionUser(c)
	r, err := globalStore.Save(user.Provider+"-"+user.ID, body.ID, body.Name, body.YAML)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(r)
}

func apiDeleteResume(c *fiber.Ctx) error {
	user, _ := sessionUser(c)
	if err := globalStore.Delete(user.Provider+"-"+user.ID, c.Params("id")); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.SendStatus(204)
}

// ── Helpers ────────────────────────────────────────────────────────

func themeNames() []string {
	entries, err := os.ReadDir("themes")
	if err != nil {
		return []string{"sap"}
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if _, err := os.Stat(filepath.Join("themes", e.Name(), "templates", "resume.hbs")); err == nil {
			names = append(names, e.Name())
		}
	}
	if len(names) == 0 {
		return []string{"sap"}
	}
	return names
}

func slugName(name string) string {
	if name == "" {
		return "resume"
	}
	return strings.ReplaceAll(strings.ToLower(name), " ", "-")
}
