package ats

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/ovsec/resumelang/internal/schema"
)

type Request struct {
	Resume         *schema.Resume `json:"-"`
	ResumeText     string         `json:"resume_text"`
	JobDescription string         `json:"job_description"`
}

type WeakBullet struct {
	Original   string `json:"original"`
	Suggestion string `json:"suggestion"`
}

type Result struct {
	Score           int          `json:"score"`
	Label           string       `json:"label"`
	Tip             string       `json:"tip,omitempty"`
	MissingKeywords []string     `json:"missing_keywords"`
	WeakBullets     []WeakBullet `json:"weak_bullets"`
	Strengths       []string     `json:"strengths"`
	Offline         bool         `json:"offline,omitempty"`
}

func scoreLabel(s int) string {
	switch {
	case s >= 90:
		return "Excellent"
	case s >= 75:
		return "Strong"
	case s >= 60:
		return "Competitive"
	case s >= 40:
		return "Developing"
	default:
		return "Needs Work"
	}
}

// ── Offline heuristic check ────────────────────────────────────────

var weakVerbs = []string{
	"helped", "worked on", "assisted", "was responsible for",
	"participated in", "involved in", "contributed to", "supported",
	"did", "made", "handled",
}

var quantifierRe = regexp.MustCompile(`\d+\s*[%xX]|\$\s*\d+|\d+[kKmMbB]\b|\d+\+`)
var wordRe = regexp.MustCompile(`\b[a-z][a-z0-9+#.\-]{2,}\b`)
var stopWords = map[string]bool{
	"the": true, "and": true, "for": true, "with": true, "you": true,
	"will": true, "our": true, "are": true, "this": true, "that": true,
	"have": true, "from": true, "your": true, "they": true, "into": true,
	"was": true, "has": true, "also": true, "such": true, "more": true,
}

// OfflineAnalyze scores a resume using weighted categories (no AI).
// Scoring breakdown (total 100 without JD, 100 with JD):
//
//	Contact      20 pts
//	Content      30 pts
//	Bullet quality 35 pts
//	JD match     15 pts (replaces 15 pts of bullet bonus when JD provided)
func OfflineAnalyze(req Request) *Result {
	r := req.Resume
	text := strings.ToLower(req.ResumeText)
	lines := strings.Split(req.ResumeText, "\n")

	var strengths []string
	var weakBullets []WeakBullet
	var missing []string
	score := 0

	// ── 1. Contact (20 pts) ──────────────────────────────────────────
	contactScore := 0
	if r != nil {
		if r.Person.Email != "" {
			contactScore += 7
		} else {
			missing = append(missing, "email address")
		}
		if r.Person.Phone != "" {
			contactScore += 6
		} else {
			missing = append(missing, "phone number")
		}
		if r.Person.Location != "" {
			contactScore += 4
		} else {
			missing = append(missing, "location")
		}
		if r.Person.LinkedIn != "" {
			contactScore += 2
		}
		if r.Person.GitHub != "" || r.Person.Website != "" {
			contactScore += 1
		}
	} else {
		// fallback: scan text
		if strings.Contains(text, "@") {
			contactScore += 7
		}
		if regexp.MustCompile(`\+?\d[\d\s\-().]{7,}`).MatchString(req.ResumeText) {
			contactScore += 6
		}
	}
	score += contactScore
	if contactScore >= 18 {
		strengths = append(strengths, "Contact information is complete")
	}

	// ── 2. Content sections (30 pts) ────────────────────────────────
	contentScore := 0
	if r != nil {
		if r.Summary != "" {
			contentScore += 8
			strengths = append(strengths, "Professional summary present")
		} else {
			missing = append(missing, "professional summary")
		}
		if len(r.Experience) > 0 {
			contentScore += 12
		} else {
			missing = append(missing, "work experience section")
		}
		if len(r.Skills) > 0 {
			contentScore += 6
		} else {
			missing = append(missing, "skills section")
		}
		if len(r.Education) > 0 {
			contentScore += 4
		}
	} else {
		if strings.Contains(text, "summary") || strings.Contains(text, "objective") {
			contentScore += 8
		}
		if strings.Contains(text, "experience") {
			contentScore += 12
		}
		if strings.Contains(text, "skills") {
			contentScore += 6
		}
	}
	score += contentScore

	// ── 3. Bullet quality (35 pts) ──────────────────────────────────
	var bulletLines []string
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if strings.HasPrefix(l, "-") || strings.HasPrefix(l, "•") {
			bulletLines = append(bulletLines, l)
		}
	}

	bulletScore := 0
	if len(bulletLines) > 0 {
		// quantification (up to 20 pts)
		quantified := 0
		for _, l := range bulletLines {
			if quantifierRe.MatchString(l) {
				quantified++
			}
		}
		ratio := float64(quantified) / float64(len(bulletLines))
		bulletScore += int(ratio * 20)
		if ratio >= 0.6 {
			strengths = append(strengths, fmt.Sprintf("%d of %d bullets contain measurable results", quantified, len(bulletLines)))
		} else if ratio < 0.25 {
			missing = append(missing, "quantified achievements (add numbers/percentages)")
		}

		// weak verb check (up to 15 pts)
		weakCount := 0
		for _, l := range bulletLines {
			ll := strings.ToLower(l)
			for _, verb := range weakVerbs {
				if strings.Contains(ll, verb) {
					orig := strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(l), "- "), "• ")
					if len(weakBullets) < 4 {
						weakBullets = append(weakBullets, WeakBullet{
							Original:   orig,
							Suggestion: "Start with a strong action verb (Led, Built, Reduced, Increased, Delivered…) and add a measurable outcome.",
						})
					}
					weakCount++
					break
				}
			}
		}
		weakRatio := float64(weakCount) / float64(len(bulletLines))
		bulletScore += int((1 - weakRatio) * 15)
		if weakCount == 0 {
			strengths = append(strengths, "Strong action verbs used throughout")
		}
	}
	score += bulletScore

	// ── 4. JD keyword match (15 pts, replaces 15 pts of slack) ──────
	if req.JobDescription != "" {
		jd := strings.ToLower(req.JobDescription)
		jdWords := wordRe.FindAllString(jd, -1)
		seen := map[string]bool{}
		var jdKeywords []string
		for _, w := range jdWords {
			if !stopWords[w] && !seen[w] && len(w) > 3 {
				seen[w] = true
				jdKeywords = append(jdKeywords, w)
			}
		}
		matched := 0
		var notFound []string
		for _, kw := range jdKeywords {
			if strings.Contains(text, kw) {
				matched++
			} else if len(notFound) < 8 {
				notFound = append(notFound, kw)
			}
		}
		if len(jdKeywords) > 0 {
			pct := float64(matched) / float64(len(jdKeywords))
			score += int(pct * 15)
			missing = append(missing, notFound...)
		}
	} else {
		score += 10 // neutral bonus when no JD provided
	}

	if score > 100 {
		score = 100
	}
	if score < 0 {
		score = 0
	}
	if len(missing) > 8 {
		missing = missing[:8]
	}

	return &Result{
		Score:           score,
		Label:           scoreLabel(score),
		Tip:             offlineTip(score, missing, weakBullets),
		MissingKeywords: missing,
		WeakBullets:     weakBullets,
		Strengths:       strengths,
		Offline:         true,
	}
}

func offlineTip(score int, missing []string, weak []WeakBullet) string {
	switch {
	case score < 40:
		return "Your resume needs structural work. Start by filling in missing contact details and adding a professional summary — ATS systems reject incomplete profiles before a human ever sees them."
	case score < 60:
		if len(weak) > 0 {
			return "Your structure is solid but your bullet points are holding you back. Rewrite passive bullets with strong action verbs and add measurable outcomes (e.g. 'Reduced deploy time by 40%')."
		}
		return "Good foundation. Add missing sections and tailor keywords to each role you apply for — even small keyword gaps can drop you below ATS cutoff thresholds."
	case score < 75:
		if len(missing) > 2 {
			return "Competitive resume. Close the keyword gaps for each specific job posting — ATS systems score you against the exact words in the job description, not general industry terms."
		}
		return "Competitive resume. Focus on quantifying more of your bullet points — resumes with 60%+ quantified bullets consistently rank higher with both ATS and recruiters."
	case score < 90:
		return "Strong resume. Fine-tune keyword alignment for each application and ensure your most impactful achievements appear in the top third of your resume."
	default:
		return "Excellent resume. You're well-optimised for ATS. Focus now on the human side — a tailored cover letter and strong LinkedIn presence will maximise your callback rate."
	}
}

// ── AI check via Grok ──────────────────────────────────────────────

const systemPrompt = `You are an expert ATS (Applicant Tracking System) analyzer and resume coach.
Analyze the resume against the job description (if provided) and return ONLY valid JSON — no markdown, no explanation.

Use this exact format:
{
  "score": 74,
  "label": "Competitive",
  "tip": "One punchy sentence of the most impactful action this person should take next.",
  "missing_keywords": ["keyword1", "keyword2"],
  "weak_bullets": [
    {"original": "exact bullet from resume", "suggestion": "stronger rewrite with action verb + metric placeholder"}
  ],
  "strengths": ["strength 1", "strength 2"]
}

Score labels: 0-39 "Needs Work", 40-59 "Developing", 60-74 "Competitive", 75-89 "Strong", 90-100 "Excellent"
Tip: the single highest-leverage thing this person can do right now. Be direct and specific — no generic advice.
Missing keywords: terms present in the JD but absent from the resume (max 8). If no JD, flag common ATS-critical gaps.
Weak bullets: bullets using passive language or lacking metrics (max 4). Skip if none found.
Strengths: 2-4 specific positive observations about the resume.`

// providerConfig returns the API endpoint and model for a given key.
// Groq keys start with "gsk_", xAI keys start with "xai-".
func providerConfig(key string) (endpoint, model string) {
	if strings.HasPrefix(key, "gsk_") {
		return "https://api.groq.com/openai/v1/chat/completions", "llama-3.3-70b-versatile"
	}
	return "https://api.x.ai/v1/chat/completions", "grok-3-mini"
}

func Analyze(req Request) (*Result, error) {
	apiKey := os.Getenv("GROQ_API_KEY")
	if apiKey == "" {
		apiKey = os.Getenv("GROK_API_KEY") // legacy alias
	}
	if apiKey == "" {
		fmt.Fprintln(os.Stderr, "[ats] no API key set (GROQ_API_KEY) — using offline analysis")
		return OfflineAnalyze(req), nil
	}

	endpoint, model := providerConfig(apiKey)
	fmt.Fprintf(os.Stderr, "[ats] using endpoint %s model %s\n", endpoint, model)

	jd := req.JobDescription
	if jd == "" {
		jd = "Not provided — perform a general ATS health check."
	}

	userMsg := fmt.Sprintf("Resume:\n%s\n\nJob Description:\n%s", req.ResumeText, jd)

	body, _ := json.Marshal(map[string]any{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": userMsg},
		},
		"temperature": 0.3,
	})

	httpReq, err := http.NewRequest("POST", endpoint, bytes.NewReader(body))
	if err != nil {
		fmt.Fprintf(os.Stderr, "[ats] request build error: %v — falling back\n", err)
		return OfflineAnalyze(req), nil
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[ats] request error: %v — falling back\n", err)
		return OfflineAnalyze(req), nil
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		fmt.Fprintf(os.Stderr, "[ats] API %d: %s — falling back\n", resp.StatusCode, string(raw))
		return OfflineAnalyze(req), nil
	}

	var grokResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &grokResp); err != nil || len(grokResp.Choices) == 0 {
		fmt.Fprintf(os.Stderr, "[ats] parse error: %v — falling back\n", err)
		return OfflineAnalyze(req), nil
	}

	var aiResult Result
	if err := json.Unmarshal([]byte(grokResp.Choices[0].Message.Content), &aiResult); err != nil {
		fmt.Fprintf(os.Stderr, "[ats] result parse error: %v — falling back\n", err)
		return OfflineAnalyze(req), nil
	}

	// merge AI + offline: AI drives score/keywords, offline fills structural gaps
	offline := OfflineAnalyze(req)

	// score: weighted average (AI 60%, offline 40%)
	merged := Result{
		Score: (aiResult.Score*60 + offline.Score*40) / 100,
	}
	merged.Label = scoreLabel(merged.Score)
	if aiResult.Tip != "" {
		merged.Tip = aiResult.Tip
	} else {
		merged.Tip = offline.Tip
	}

	// missing keywords: AI first, then offline structural gaps not already covered
	seen := map[string]bool{}
	for _, k := range aiResult.MissingKeywords {
		merged.MissingKeywords = append(merged.MissingKeywords, k)
		seen[strings.ToLower(k)] = true
	}
	for _, k := range offline.MissingKeywords {
		if !seen[strings.ToLower(k)] {
			merged.MissingKeywords = append(merged.MissingKeywords, k)
		}
	}
	if len(merged.MissingKeywords) > 8 {
		merged.MissingKeywords = merged.MissingKeywords[:8]
	}

	// weak bullets: AI suggestions are more specific, offline catches leftovers
	merged.WeakBullets = aiResult.WeakBullets
	aiOriginals := map[string]bool{}
	for _, b := range aiResult.WeakBullets {
		aiOriginals[strings.ToLower(b.Original)] = true
	}
	for _, b := range offline.WeakBullets {
		if !aiOriginals[strings.ToLower(b.Original)] && len(merged.WeakBullets) < 5 {
			merged.WeakBullets = append(merged.WeakBullets, b)
		}
	}

	// strengths: union, deduplicated
	strengthSeen := map[string]bool{}
	for _, s := range aiResult.Strengths {
		merged.Strengths = append(merged.Strengths, s)
		strengthSeen[strings.ToLower(s)] = true
	}
	for _, s := range offline.Strengths {
		if !strengthSeen[strings.ToLower(s)] {
			merged.Strengths = append(merged.Strengths, s)
		}
	}

	return &merged, nil
}
