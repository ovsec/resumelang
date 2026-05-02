package server

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

const (
	cookieSession = "rl_session"
	cookieState   = "rl_oauth_state"
	cookieMaxAge  = 60 * 60 * 24 * 7
)

type UserProfile struct {
	Provider string `json:"provider"`
	ID       string `json:"id"`
	Login    string `json:"login,omitempty"`
	Name     string `json:"name,omitempty"`
	Email    string `json:"email,omitempty"`
	Avatar   string `json:"avatar,omitempty"`
}

type oauthProvider struct {
	name        string
	clientID    string
	secret      string
	authURL     string
	tokenURL    string
	userURL     string
	scope       string
	parseUser   func(map[string]any) UserProfile
}

var sessionKey = func() []byte {
	if s := os.Getenv("RL_AUTH_SECRET"); s != "" {
		return []byte(s)
	}
	b := make([]byte, 32)
	rand.Read(b)
	return b
}()

func configuredProviders() map[string]*oauthProvider {
	out := map[string]*oauthProvider{}
	if id, sec := os.Getenv("RL_GITHUB_CLIENT_ID"), os.Getenv("RL_GITHUB_CLIENT_SECRET"); id != "" && sec != "" {
		out["github"] = &oauthProvider{
			name: "github", clientID: id, secret: sec,
			authURL:  "https://github.com/login/oauth/authorize",
			tokenURL: "https://github.com/login/oauth/access_token",
			userURL:  "https://api.github.com/user",
			scope:    "read:user user:email",
			parseUser: func(m map[string]any) UserProfile {
				return UserProfile{
					Provider: "github",
					ID:       fmt.Sprintf("%v", m["id"]),
					Login:    asStr(m["login"]),
					Name:     asStr(m["name"]),
					Email:    asStr(m["email"]),
					Avatar:   asStr(m["avatar_url"]),
				}
			},
		}
	}
	if id, sec := os.Getenv("RL_LINKEDIN_CLIENT_ID"), os.Getenv("RL_LINKEDIN_CLIENT_SECRET"); id != "" && sec != "" {
		out["linkedin"] = &oauthProvider{
			name: "linkedin", clientID: id, secret: sec,
			authURL:  "https://www.linkedin.com/oauth/v2/authorization",
			tokenURL: "https://www.linkedin.com/oauth/v2/accessToken",
			userURL:  "https://api.linkedin.com/v2/userinfo",
			scope:    "openid profile email",
			parseUser: func(m map[string]any) UserProfile {
				return UserProfile{
					Provider: "linkedin",
					ID:       asStr(m["sub"]),
					Login:    asStr(m["preferred_username"]),
					Name:     asStr(m["name"]),
					Email:    asStr(m["email"]),
					Avatar:   asStr(m["picture"]),
				}
			},
		}
	}
	if id, sec := os.Getenv("RL_GOOGLE_CLIENT_ID"), os.Getenv("RL_GOOGLE_CLIENT_SECRET"); id != "" && sec != "" {
		out["google"] = &oauthProvider{
			name: "google", clientID: id, secret: sec,
			authURL:  "https://accounts.google.com/o/oauth2/v2/auth",
			tokenURL: "https://oauth2.googleapis.com/token",
			userURL:  "https://openidconnect.googleapis.com/v1/userinfo",
			scope:    "openid email profile",
			parseUser: func(m map[string]any) UserProfile {
				return UserProfile{
					Provider: "google",
					ID:       asStr(m["sub"]),
					Login:    asStr(m["email"]),
					Name:     asStr(m["name"]),
					Email:    asStr(m["email"]),
					Avatar:   asStr(m["picture"]),
				}
			},
		}
	}
	return out
}

func providerList() []string {
	names := []string{}
	for n := range configuredProviders() {
		names = append(names, n)
	}
	return names
}

func sign(payload []byte) string {
	mac := hmac.New(sha256.New, sessionKey)
	mac.Write(payload)
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func encodeSession(p UserProfile) (string, error) {
	body, err := json.Marshal(p)
	if err != nil {
		return "", err
	}
	enc := base64.RawURLEncoding.EncodeToString(body)
	return enc + "." + sign([]byte(enc)), nil
}

func decodeSession(token string) (UserProfile, bool) {
	var p UserProfile
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return p, false
	}
	if !hmac.Equal([]byte(sign([]byte(parts[0]))), []byte(parts[1])) {
		return p, false
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return p, false
	}
	if json.Unmarshal(body, &p) != nil {
		return p, false
	}
	return p, true
}

func sessionUser(c *fiber.Ctx) (UserProfile, bool) {
	val := c.Cookies(cookieSession)
	if val == "" {
		return UserProfile{}, false
	}
	return decodeSession(val)
}

func authStart(c *fiber.Ctx) error {
	name := c.Params("provider")
	p, ok := configuredProviders()[name]
	if !ok {
		return c.Status(501).SendString(name + " not configured")
	}
	state := randState()
	c.Cookie(&fiber.Cookie{
		Name: cookieState, Value: state,
		MaxAge: 600, HTTPOnly: true, SameSite: "Lax",
	})
	q := url.Values{}
	q.Set("client_id", p.clientID)
	q.Set("redirect_uri", origin(c)+"/auth/"+p.name+"/callback")
	q.Set("scope", p.scope)
	q.Set("state", state)
	q.Set("response_type", "code")
	return c.Redirect(p.authURL + "?" + q.Encode())
}

func authCallbackHandler(c *fiber.Ctx) error {
	name := c.Params("provider")
	p, ok := configuredProviders()[name]
	if !ok {
		return c.Status(501).SendString("provider not configured")
	}
	wantState := c.Cookies(cookieState)
	if wantState == "" || wantState != c.Query("state") {
		return c.Status(400).SendString("state mismatch")
	}
	c.Cookie(&fiber.Cookie{Name: cookieState, Value: "", MaxAge: -1})

	code := c.Query("code")
	if code == "" {
		return c.Status(400).SendString("missing code")
	}
	tok, err := exchangeCode(p, code, origin(c)+"/auth/"+p.name+"/callback")
	if err != nil {
		return c.Status(502).SendString("token exchange: " + err.Error())
	}
	user, err := fetchUser(p, tok)
	if err != nil {
		return c.Status(502).SendString("user fetch: " + err.Error())
	}
	sess, err := encodeSession(user)
	if err != nil {
		return c.Status(500).SendString("session: " + err.Error())
	}
	c.Cookie(&fiber.Cookie{
		Name: cookieSession, Value: sess,
		MaxAge: cookieMaxAge, HTTPOnly: true, SameSite: "Lax",
	})
	return c.Redirect("/dashboard")
}

func authLogout(c *fiber.Ctx) error {
	c.Cookie(&fiber.Cookie{Name: cookieSession, Value: "", MaxAge: -1})
	return c.Redirect("/")
}

func origin(c *fiber.Ctx) string {
	scheme := "http"
	if c.Protocol() == "https" || c.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	host := c.Hostname()
	if h := c.Get("X-Forwarded-Host"); h != "" {
		host = h
	}
	return scheme + "://" + host
}

func randState() string {
	b := make([]byte, 24)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func exchangeCode(p *oauthProvider, code, redirect string) (string, error) {
	form := url.Values{}
	form.Set("client_id", p.clientID)
	form.Set("client_secret", p.secret)
	form.Set("code", code)
	form.Set("redirect_uri", redirect)
	form.Set("grant_type", "authorization_code")
	req, _ := http.NewRequest("POST", p.tokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("status %d: %s", resp.StatusCode, body)
	}
	var data map[string]any
	if err := json.Unmarshal(body, &data); err != nil {
		v, perr := url.ParseQuery(string(body))
		if perr != nil {
			return "", fmt.Errorf("parse: %v / %v", err, perr)
		}
		return v.Get("access_token"), nil
	}
	if t, ok := data["access_token"].(string); ok {
		return t, nil
	}
	return "", fmt.Errorf("no access_token in: %s", body)
}

func fetchUser(p *oauthProvider, token string) (UserProfile, error) {
	req, _ := http.NewRequest("GET", p.userURL, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return UserProfile{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return UserProfile{}, fmt.Errorf("status %d: %s", resp.StatusCode, body)
	}
	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		return UserProfile{}, err
	}
	return p.parseUser(m), nil
}

func asStr(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprintf("%v", v)
}
