package cmd

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func ServeStatic(args []string) {
	addr := "0.0.0.0"
	port := "3000"
	root, _ := os.Getwd()

	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--port", "-p":
			i++
			if i < len(args) {
				port = args[i]
			}
		case "--addr":
			i++
			if i < len(args) {
				addr = args[i]
			}
		case "--root":
			i++
			if i < len(args) {
				root = args[i]
			}
		}
	}

	webDir := filepath.Join(root, "web")
	themesDir := filepath.Join(root, "themes")
	schemaDir := filepath.Join(root, "schema")

	if _, err := os.Stat(webDir); err != nil {
		fmt.Fprintln(os.Stderr, "error: web/ dir not found at", webDir)
		os.Exit(1)
	}

	mux := http.NewServeMux()

	// Landing page
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(webDir, "landing.html"))
	})

	// Editor shell
	mux.HandleFunc("/editor", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, filepath.Join(webDir, "index.html"))
	})

	// Login page
	mux.HandleFunc("/login", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, filepath.Join(webDir, "login.html"))
	})

	// Read-only resume view (shareable link)
	mux.HandleFunc("/r", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, filepath.Join(webDir, "view.html"))
	})

	// OAuth + session
	registerAuthRoutes(mux)

	// Static editor assets
	mux.Handle("/web/", http.StripPrefix("/web/", safeFileServer(webDir)))

	// Static theme files (templates + assets + theme.yml)
	mux.Handle("/themes/", http.StripPrefix("/themes/", safeFileServer(themesDir)))

	// JSON Schema (used by editor's $schema link + external tools)
	mux.HandleFunc("/schema/", func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/schema/")
		if strings.Contains(name, "..") || name == "" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/schema+json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		http.ServeFile(w, r, filepath.Join(schemaDir, name))
	})

	// API: list theme names
	mux.HandleFunc("/api/themes", func(w http.ResponseWriter, r *http.Request) {
		var names []string
		if entries, err := os.ReadDir(themesDir); err == nil {
			for _, e := range entries {
				if !e.IsDir() {
					continue
				}
				if _, err := os.Stat(filepath.Join(themesDir, e.Name(), "templates", "resume.hbs")); err != nil {
					continue
				}
				names = append(names, e.Name())
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"themes":[`))
		for i, n := range names {
			if i > 0 {
				w.Write([]byte(","))
			}
			w.Write([]byte(`"` + n + `"`))
		}
		w.Write([]byte(`]}`))
	})

	url := fmt.Sprintf("http://%s:%s", addr, port)
	fmt.Println("==============================================")
	fmt.Println("  resumelang editor")
	fmt.Println("==============================================")
	fmt.Println("  Editor:    " + url)
	fmt.Println("  Login:     " + url + "/login")
	fmt.Println("  Themes:    " + url + "/api/themes")
	avail := providers()
	if len(avail) == 0 {
		fmt.Println("  Auth:      offline only (no RL_*_CLIENT_ID set)")
	} else {
		names := []string{}
		for n := range avail {
			names = append(names, n)
		}
		fmt.Println("  Auth:      " + strings.Join(names, ", "))
	}
	fmt.Println("==============================================")

	if err := http.ListenAndServe(addr+":"+port, mux); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

// safeFileServer serves files from root, refusing path traversal.
func safeFileServer(root string) http.Handler {
	fs := http.FileServer(http.Dir(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := filepath.Clean(r.URL.Path)
		if strings.Contains(clean, "..") {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		// disable directory listings
		if strings.HasSuffix(r.URL.Path, "/") {
			http.NotFound(w, r)
			return
		}
		fs.ServeHTTP(w, r)
	})
}
