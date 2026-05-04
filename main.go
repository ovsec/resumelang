package main

import (
	"bufio"
	"os"
	"strings"

	"github.com/ovsec/resumelang/cmd"
)

func main() {
	loadEnvLocal(".env.local")
	cmd.Execute()
}

// loadEnvLocal reads KEY=VALUE pairs from a .env file and sets them as
// environment variables, but only if the key is not already set. This lets
// real environment variables (CI, Docker, etc.) always win over the local file.
func loadEnvLocal(path string) {
	f, err := os.Open(path)
	if err != nil {
		return // file absent is normal in production
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		// Strip surrounding quotes
		if len(v) >= 2 {
			if (v[0] == '"' && v[len(v)-1] == '"') || (v[0] == '\'' && v[len(v)-1] == '\'') {
				v = v[1 : len(v)-1]
			}
		}
		if k != "" && os.Getenv(k) == "" {
			os.Setenv(k, v)
		}
	}
}
