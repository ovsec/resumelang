package cmd

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
)

const (
	cookieSession = "rl_session"
	cookieState   = "rl_oauth_state"
	cookieMaxAge  = 60 * 60 * 24 * 7
)

type oauthProvider struct {
	name        string
	clientID    string
	secret      string
	authURL     string
	tokenURL    string
	userURL     string
	scope       string
	parseUser   func(map[string]any) UserProfile
	authHeaders map[string]string
}

type UserProfile struct {
	Provider string `json:"provider"`
	ID       string `json:"id"`
	Login    string `json:"login,omitempty"`
	Name     string `json:"name,omitempty"`
	Email    string `json:"email,omitempty"`
	Avatar   string `json:"avatar,omitempty"`
}

func authSecret() []byte {
	if s := os.Getenv("RL_AUTH_SECRET"); s != "" {
		return []byte(s)
	}
	// dev fallback — non-persistent, regenerated each start
	b := make([]byte, 32)
	rand.Read(b)
	return b
}

var sessionKey = authSecret()

func providers() map[string]*oauthProvider {
	out := map[string]*oauthProvider{}
	if id, sec := os.Getenv("RL_GITHUB_CLIENT_ID"), os.Getenv("RL_GITHUB_CLIENT_SECRET"); id != "" && sec != "" {
		out["github"] = &oauthProvider{
			name:     "github",
			clientID: id,
			secret:   sec,
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
			name:     "linkedin",
			clientID: id,
			secret:   sec,
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
	return out
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

func setCookie(w http.ResponseWriter, name, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func origin(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	host := r.Host
	if h := r.Header.Get("X-Forwarded-Host"); h != "" {
		host = h
	}
	return scheme + "://" + host
}

func randState() string {
	b := make([]byte, 24)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func registerAuthRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/auth/", func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/auth/")
		parts := strings.SplitN(path, "/", 2)
		if len(parts) == 0 || parts[0] == "" {
			http.NotFound(w, r)
			return
		}
		switch parts[0] {
		case "logout":
			setCookie(w, cookieSession, "", -1)
			http.Redirect(w, r, "/", http.StatusFound)
			return
		}
		if len(parts) == 2 && parts[1] == "callback" {
			handleCallback(w, r, parts[0])
			return
		}
		if len(parts) == 1 {
			handleStart(w, r, parts[0])
			return
		}
		http.NotFound(w, r)
	})

	mux.HandleFunc("/api/me", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		c, err := r.Cookie(cookieSession)
		if err != nil || c.Value == "" {
			io.WriteString(w, `{"user":null,"providers":`+providersJSON()+`}`)
			return
		}
		p, ok := decodeSession(c.Value)
		if !ok {
			io.WriteString(w, `{"user":null,"providers":`+providersJSON()+`}`)
			return
		}
		body, _ := json.Marshal(map[string]any{"user": p})
		s := strings.TrimSuffix(string(body), "}")
		io.WriteString(w, s+`,"providers":`+providersJSON()+`}`)
	})
}

func providersJSON() string {
	avail := providers()
	names := []string{}
	for n := range avail {
		names = append(names, `"`+n+`"`)
	}
	return "[" + strings.Join(names, ",") + "]"
}

func handleStart(w http.ResponseWriter, r *http.Request, name string) {
	p, ok := providers()[name]
	if !ok {
		http.Error(w, name+" not configured (set RL_"+strings.ToUpper(name)+"_CLIENT_ID and *_SECRET)", http.StatusNotImplemented)
		return
	}
	state := randState()
	setCookie(w, cookieState, state, 600)

	q := url.Values{}
	q.Set("client_id", p.clientID)
	q.Set("redirect_uri", origin(r)+"/auth/"+p.name+"/callback")
	q.Set("scope", p.scope)
	q.Set("state", state)
	q.Set("response_type", "code")

	http.Redirect(w, r, p.authURL+"?"+q.Encode(), http.StatusFound)
}

func handleCallback(w http.ResponseWriter, r *http.Request, name string) {
	p, ok := providers()[name]
	if !ok {
		http.Error(w, "provider not configured", http.StatusNotImplemented)
		return
	}
	wantState, _ := r.Cookie(cookieState)
	if wantState == nil || wantState.Value == "" || wantState.Value != r.URL.Query().Get("state") {
		http.Error(w, "state mismatch", http.StatusBadRequest)
		return
	}
	setCookie(w, cookieState, "", -1)

	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "missing code", http.StatusBadRequest)
		return
	}

	tok, err := exchangeCode(p, code, origin(r)+"/auth/"+p.name+"/callback")
	if err != nil {
		http.Error(w, "token exchange: "+err.Error(), http.StatusBadGateway)
		return
	}

	user, err := fetchUser(p, tok)
	if err != nil {
		http.Error(w, "user fetch: "+err.Error(), http.StatusBadGateway)
		return
	}

	sess, err := encodeSession(user)
	if err != nil {
		http.Error(w, "session: "+err.Error(), http.StatusInternalServerError)
		return
	}
	setCookie(w, cookieSession, sess, cookieMaxAge)
	http.Redirect(w, r, "/", http.StatusFound)
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
		// some providers (older github) return form-encoded
		v, perr := url.ParseQuery(string(body))
		if perr != nil {
			return "", fmt.Errorf("parse token: %v / %v", err, perr)
		}
		return v.Get("access_token"), nil
	}
	if t, ok := data["access_token"].(string); ok {
		return t, nil
	}
	return "", fmt.Errorf("no access_token in response: %s", body)
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
