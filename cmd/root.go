package cmd

import (
	"fmt"
	"os"
)

// Version is set at build time via -ldflags "-X main.version=..."
var Version = "dev"

func Execute() {
	args := os.Args[1:]
	if len(args) == 0 {
		usage()
		os.Exit(2)
	}
	switch args[0] {
	case "build":
		Build(args[1:])
	case "validate":
		Validate(args[1:])
	case "init":
		Init(args[1:])
	case "themes":
		Themes()
	case "serve":
		Serve(args[1:])
	case "serve-static":
		ServeStatic(args[1:])
	case "version", "--version", "-v":
		fmt.Println("resumelang " + Version)
	case "help", "--help", "-h":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n\n", args[0])
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Print(`resumelang — universal resume DSL compiler + editor

Usage:
  resumelang <command> [args]

Commands:
  build [file] [flags]   Compile resume.yml to all formats
  validate [file]        Validate resume.yml
  init [file]            Create starter resume.yml
  serve [flags]          Launch web editor (default :7070)
  themes                 List available themes
  version                Print version

Build flags:
  --out <dir>            Output directory (default: dist)
  --formats <list>       Comma-separated: html,json,txt,md (default: all)

Serve flags:
  --port <n>             Port to listen on (default: 7070)
  --addr <host>          Bind address (default: 127.0.0.1)

Examples:
  resumelang init
  resumelang build resume.yml --out site
  resumelang serve --port 8080
  resumelang validate resume.yml
`)
}

func die(msg string) {
	fmt.Fprintln(os.Stderr, "error: "+msg)
	os.Exit(1)
}
