package cmd

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func ServeStatic(args []string) {
	addr := "127.0.0.1"
	port := "5500"
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

	// Editor shell
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(webDir, "index.html"))
	})

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
	fmt.Println("  Themes:    " + url + "/api/themes")
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
