package server

import (
	"archive/zip"
	"bytes"
	"compress/zlib"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode"

	"github.com/gofiber/fiber/v2"
	"github.com/ovsec/resumelang/internal/ats"
	"github.com/ovsec/resumelang/internal/compiler"
	"github.com/ovsec/resumelang/internal/mdsync"
	"github.com/ovsec/resumelang/internal/parser"
	"github.com/ovsec/resumelang/internal/schema"
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
	user, loggedIn := sessionUser(c)
	data := fiber.Map{
		"Title":    "resumelang — editor",
		"Themes":   themeNames(),
	}
	if loggedIn {
		data["User"] = user
	}
	return c.Render("editor", data)
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
	user, loggedIn := sessionUser(c)
	data := fiber.Map{
		"Title": "My Resumes - resumelang",
		"Providers": providerList(),
	}
	if loggedIn {
		uid := user.Provider + "-" + user.ID
		resumes, _ := globalStore.List(uid)
		data["User"] = user
		data["Resumes"] = resumes
	}
	return c.Render("dashboard", data)
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

// ── ATS ────────────────────────────────────────────────────────────

func apiATS(c *fiber.Ctx) error {
	var body struct {
		YAML           string `json:"yaml"`
		JobDescription string `json:"job_description"`
	}
	if err := c.BodyParser(&body); err != nil || body.YAML == "" {
		return c.Status(400).JSON(fiber.Map{"error": "missing yaml"})
	}
	r, err := parser.ParseBytes([]byte(body.YAML))
	if err != nil {
		return c.Status(422).JSON(fiber.Map{"error": "YAML: " + err.Error()})
	}
	resumeText := string(compiler.ToATS(r))
	result, err := ats.Analyze(ats.Request{
		Resume:         r,
		ResumeText:     resumeText,
		JobDescription: body.JobDescription,
	})
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(result)
}

// ── User Resumes ───────────────────────────────────────────────────

func apiPublicResume(c *fiber.Ctx) error {
	fullID := c.Params("id") // may be "uid.rid" or just "rid"
	// Support both "uid.rid" (new public links) and legacy "rid" formats
	var r SavedResume
	var err error
	if strings.Contains(fullID, ".") {
		parts := strings.SplitN(fullID, ".", 2)
		uid, rid := parts[0], parts[1]
		r, err = globalStore.GetByIDAndUser(rid, uid)
	} else {
		r, err = globalStore.GetByID(fullID)
	}
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "not found"})
	}
	// For password-protected shares, the client sends the password in the query.
	pw := c.Query("pw", "")
	if r.Password != "" {
		if pw == "" {
			return c.Status(401).JSON(fiber.Map{"error": "password required"})
		}
		h := fmt.Sprintf("%x", sha256.Sum256([]byte(pw)))
		if h != r.Password {
			return c.Status(403).JSON(fiber.Map{"error": "wrong password"})
		}
	}
	return c.JSON(fiber.Map{"yaml": r.YAML})
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
		ID         string `json:"id"`
		Name       string `json:"name"`
		YAML       string `json:"yaml"`
		Visibility string `json:"visibility"` // private | public | password
		Password   string `json:"password"`   // plaintext, only sent when visibility=password
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid body"})
	}
	user, _ := sessionUser(c)
	visibility := body.Visibility
	if visibility == "" {
		visibility = "private"
	}
	r, err := globalStore.Save(user.Provider+"-"+user.ID, body.ID, body.Name, body.YAML, visibility, body.Password)
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

// ── Import API ──────────────────────────────────────────────────────

const (
	maxImportUploadBytes = 10 << 20
	maxDocxEntries       = 256
	maxDocxXMLBytes      = 2 << 20
	maxPDFStreamBytes    = 4 << 20
)

func apiImportResume(c *fiber.Ctx) error {
	if c.Request().Header.ContentLength() > maxImportUploadBytes {
		return c.Status(413).JSON(fiber.Map{"error": "file is larger than 10 MB"})
	}
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "no file uploaded"})
	}
	if file.Size > maxImportUploadBytes {
		return c.Status(413).JSON(fiber.Map{"error": "file is larger than 10 MB"})
	}

	tmp, err := os.CreateTemp("", "resumelang-import-*")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to prepare upload"})
	}
	tmpFile := tmp.Name()
	tmp.Close()
	if err := c.SaveFile(file, tmpFile); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to save file"})
	}
	defer os.Remove(tmpFile)

	ext := strings.ToLower(filepath.Ext(file.Filename))
	var yamlOut string
	switch ext {
	case ".yml", ".yaml":
		data, err := os.ReadFile(tmpFile)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "failed to read YAML"})
		}
		yamlOut, err = normalizeImportedYAML(data, true)
		if err != nil {
			return c.Status(422).JSON(fiber.Map{"error": err.Error()})
		}
	case ".md", ".markdown":
		data, err := os.ReadFile(tmpFile)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "failed to read Markdown"})
		}
		r, err := mdsync.FromMarkdown(string(data))
		if err != nil {
			return c.Status(422).JSON(fiber.Map{"error": "failed to convert Markdown: " + err.Error()})
		}
		yamlOut, err = resumeToImportYAML(r)
		if err != nil {
			return c.Status(422).JSON(fiber.Map{"error": err.Error()})
		}
	case ".pdf":
		text, err := extractPDFText(tmpFile)
		if err != nil {
			return c.Status(422).JSON(fiber.Map{"error": "failed to extract PDF text: " + err.Error()})
		}
		yamlOut, err = plainTextToImportYAML(text)
		if err != nil {
			return c.Status(422).JSON(fiber.Map{"error": err.Error()})
		}
	case ".docx":
		text, err := extractDocxText(tmpFile)
		if err != nil {
			return c.Status(422).JSON(fiber.Map{"error": "failed to extract DOCX text: " + err.Error()})
		}
		yamlOut, err = plainTextToImportYAML(text)
		if err != nil {
			return c.Status(422).JSON(fiber.Map{"error": err.Error()})
		}
	default:
		return c.Status(400).JSON(fiber.Map{"error": "unsupported file type: " + ext + " (use PDF, DOCX, Markdown, YAML, or YML)"})
	}

	return c.JSON(fiber.Map{"yaml": yamlOut})
}

func extractPDFText(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if !bytes.HasPrefix(bytes.TrimSpace(data), []byte("%PDF-")) {
		return "", fmt.Errorf("not a PDF file")
	}
	text, err := pdfTextFromStreams(data)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(text) == "" {
		return "", fmt.Errorf("no readable text found; scanned or image-only PDFs are not supported")
	}
	return text, nil
}

func pdfTextFromStreams(data []byte) (string, error) {
	var text []string
	searchFrom := 0
	for {
		streamRel := bytes.Index(data[searchFrom:], []byte("stream"))
		if streamRel < 0 {
			break
		}
		streamStart := searchFrom + streamRel
		contentStart := streamStart + len("stream")
		if contentStart < len(data) && data[contentStart] == '\r' {
			contentStart++
		}
		if contentStart < len(data) && data[contentStart] == '\n' {
			contentStart++
		}
		endRel := bytes.Index(data[contentStart:], []byte("endstream"))
		if endRel < 0 {
			break
		}
		contentEnd := contentStart + endRel
		if contentEnd-contentStart > maxPDFStreamBytes {
			return "", fmt.Errorf("PDF content stream is too large")
		}
		stream := bytes.Trim(data[contentStart:contentEnd], "\r\n")
		dictStart := streamStart - 512
		if dictStart < 0 {
			dictStart = 0
		}
		dict := data[dictStart:streamStart]
		if bytes.Contains(dict, []byte("/FlateDecode")) {
			zr, err := zlib.NewReader(bytes.NewReader(stream))
			if err == nil {
				decoded, readErr := io.ReadAll(io.LimitReader(zr, maxPDFStreamBytes+1))
				zr.Close()
				if readErr != nil {
					return "", readErr
				}
				if len(decoded) > maxPDFStreamBytes {
					return "", fmt.Errorf("PDF content stream is too large")
				}
				stream = decoded
			}
		}
		text = append(text, pdfTextStrings(stream)...)
		searchFrom = contentEnd + len("endstream")
	}
	if len(text) == 0 {
		return "", nil
	}
	return strings.Join(text, "\n"), nil
}

func pdfTextStrings(stream []byte) []string {
	var out []string
	for i := 0; i < len(stream); i++ {
		switch stream[i] {
		case '(':
			value, next := readPDFLiteralString(stream, i+1)
			if usefulImportText(value) {
				out = append(out, value)
			}
			i = next
		case '<':
			if i+1 < len(stream) && stream[i+1] == '<' {
				continue
			}
			value, next := readPDFHexString(stream, i+1)
			if usefulImportText(value) {
				out = append(out, value)
			}
			i = next
		}
	}
	return out
}

func readPDFLiteralString(data []byte, start int) (string, int) {
	var b strings.Builder
	depth := 1
	for i := start; i < len(data); i++ {
		c := data[i]
		if c == '\\' {
			if i+1 >= len(data) {
				break
			}
			i++
			switch data[i] {
			case 'n':
				b.WriteByte('\n')
			case 'r':
				b.WriteByte('\r')
			case 't':
				b.WriteByte('\t')
			default:
				b.WriteByte(data[i])
			}
			continue
		}
		if c == '(' {
			depth++
		}
		if c == ')' {
			depth--
			if depth == 0 {
				return strings.Join(strings.Fields(b.String()), " "), i
			}
		}
		b.WriteByte(c)
	}
	return strings.Join(strings.Fields(b.String()), " "), len(data) - 1
}

func readPDFHexString(data []byte, start int) (string, int) {
	end := start
	for end < len(data) && data[end] != '>' {
		end++
	}
	raw := strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return r
	}, string(data[start:end]))
	if len(raw)%2 == 1 {
		raw += "0"
	}
	decoded, err := hex.DecodeString(raw)
	if err != nil {
		return "", end
	}
	if len(decoded) >= 2 && decoded[0] == 0xfe && decoded[1] == 0xff {
		var b strings.Builder
		for i := 2; i+1 < len(decoded); i += 2 {
			r := rune(decoded[i])<<8 | rune(decoded[i+1])
			b.WriteRune(r)
		}
		return strings.Join(strings.Fields(b.String()), " "), end
	}
	return strings.Join(strings.Fields(string(decoded)), " "), end
}

func usefulImportText(s string) bool {
	if len(s) < 2 {
		return false
	}
	letters := 0
	for _, r := range s {
		if unicode.IsLetter(r) {
			letters++
		}
	}
	return letters >= 2
}

func extractDocxText(path string) (string, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return "", err
	}
	defer zr.Close()
	if len(zr.File) > maxDocxEntries {
		return "", fmt.Errorf("DOCX has too many entries")
	}

	for _, f := range zr.File {
		if f.Name != "word/document.xml" {
			continue
		}
		if f.UncompressedSize64 > maxDocxXMLBytes {
			return "", fmt.Errorf("DOCX document is too large")
		}
		rc, err := f.Open()
		if err != nil {
			return "", err
		}
		defer rc.Close()
		data, err := io.ReadAll(io.LimitReader(rc, maxDocxXMLBytes+1))
		if err != nil {
			return "", err
		}
		if len(data) > maxDocxXMLBytes {
			return "", fmt.Errorf("DOCX document is too large")
		}
		text, err := docxXMLText(bytes.NewReader(data))
		if err != nil {
			return "", err
		}
		if strings.TrimSpace(text) == "" {
			return "", fmt.Errorf("no readable text found")
		}
		return text, nil
	}
	return "", fmt.Errorf("word/document.xml not found")
}

func normalizeImportedYAML(data []byte, preserve bool) (string, error) {
	r, err := parser.ParseBytes(data)
	if err != nil {
		return "", fmt.Errorf("YAML: %w", err)
	}
	if errs := parser.Validate(r); len(errs) > 0 {
		return "", fmt.Errorf("invalid ResumeLang YAML: %s", strings.Join(errs, "; "))
	}
	if preserve {
		text := strings.TrimSpace(string(data))
		if strings.Contains(text, "yaml-language-server: $schema=") {
			return text + "\n", nil
		}
		return schemaHeader() + text + "\n", nil
	}
	return resumeToImportYAML(r)
}

func resumeToImportYAML(r *schema.Resume) (string, error) {
	if r.Resumelang == "" {
		r.Resumelang = schema.CurrentSpec
	}
	parser.ApplyDefaults(r)
	if strings.TrimSpace(r.Person.Name) == "" {
		r.Person.Name = "Imported Resume"
	}
	if errs := parser.Validate(r); len(errs) > 0 {
		return "", fmt.Errorf("converted resume is invalid: %s", strings.Join(errs, "; "))
	}
	data, err := parser.Marshal(r)
	if err != nil {
		return "", err
	}
	return schemaHeader() + string(data), nil
}

func plainTextToImportYAML(text string) (string, error) {
	lines := cleanImportLines(text)
	if len(lines) == 0 {
		return "", fmt.Errorf("no readable resume text found")
	}
	r := &schema.Resume{Resumelang: schema.CurrentSpec}
	parser.ApplyDefaults(r)
	r.Person.Name = lines[0]
	if len(lines) > 1 && !looksLikeContact(lines[1]) {
		r.Person.Title = lines[1]
	}
	for _, line := range lines {
		if strings.Contains(line, "@") && r.Person.Email == "" {
			r.Person.Email = firstEmail(line)
			continue
		}
		if r.Person.Phone == "" && looksLikePhone(line) {
			r.Person.Phone = line
		}
	}
	start := 1
	if r.Person.Title != "" {
		start = 2
	}
	var summary []string
	for _, line := range lines[start:] {
		if looksLikeContact(line) || looksLikeSectionHeading(line) {
			continue
		}
		summary = append(summary, line)
		if len(strings.Join(summary, " ")) > 280 || len(summary) == 4 {
			break
		}
	}
	if len(summary) > 0 {
		r.Summary = strings.Join(summary, " ")
	}
	return resumeToImportYAML(r)
}

func cleanImportLines(text string) []string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	var lines []string
	for _, line := range strings.Split(text, "\n") {
		line = strings.Join(strings.Fields(strings.TrimSpace(line)), " ")
		if line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

func docxXMLText(r io.Reader) (string, error) {
	decoder := xml.NewDecoder(r)
	var b strings.Builder
	for {
		tok, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}
		switch t := tok.(type) {
		case xml.CharData:
			b.Write([]byte(t))
		case xml.EndElement:
			if t.Name.Local == "p" {
				b.WriteByte('\n')
			}
		}
	}
	return b.String(), nil
}

func schemaHeader() string {
	return "# yaml-language-server: $schema=https://resumelang.dev/schema/v1.json\n"
}

func looksLikeContact(line string) bool {
	low := strings.ToLower(line)
	return strings.Contains(line, "@") || strings.Contains(low, "linkedin") || strings.Contains(low, "github") || strings.Contains(low, "http") || looksLikePhone(line)
}

func looksLikePhone(line string) bool {
	digits := 0
	for _, r := range line {
		if unicode.IsDigit(r) {
			digits++
		}
	}
	return digits >= 7 && digits <= 18
}

func firstEmail(line string) string {
	for _, part := range strings.Fields(line) {
		part = strings.Trim(part, "<>,;()[]{}")
		if strings.Contains(part, "@") {
			return part
		}
	}
	return line
}

func looksLikeSectionHeading(line string) bool {
	switch strings.ToLower(strings.Trim(line, ":")) {
	case "summary", "experience", "work experience", "education", "skills", "projects", "certifications", "languages", "awards":
		return true
	default:
		return false
	}
}
