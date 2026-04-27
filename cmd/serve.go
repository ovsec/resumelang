package cmd

import "github.com/ovsec/resumelang/internal/server"

func Serve(args []string) {
	server.Start(args)
}
