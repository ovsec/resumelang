package cmd

import (
	"fmt"

	"github.com/ovsec/resumelang/internal/compiler"
)

func Themes() {
	fmt.Println("Available themes:")
	for _, t := range compiler.ThemeNames() {
		fmt.Println("  - " + t)
	}
}
