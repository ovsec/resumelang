package cmd

import (
	"fmt"
	"os"

	"github.com/ovsec/resumelang/internal/parser"
)

func Validate(args []string) {
	file := "resume.yml"
	if len(args) > 0 {
		file = args[0]
	}
	r, err := parser.Parse(file)
	if err != nil {
		die(err.Error())
	}
	for _, w := range parser.Warnings(r) {
		fmt.Fprintln(os.Stderr, "warn: "+w)
	}
	errs := parser.Validate(r)
	if len(errs) == 0 {
		fmt.Printf("ok: %s is valid\n", file)
		return
	}
	for _, e := range errs {
		fmt.Fprintln(os.Stderr, "error: "+e)
	}
	os.Exit(1)
}
