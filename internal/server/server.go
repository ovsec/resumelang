package server

import (
	"context"
	"fmt"
	"os"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/gofiber/template/html/v2"
)

func Start(args []string) {
	var err error
	globalStore, err = NewStore(context.Background())
	if err != nil {
		fmt.Fprintln(os.Stderr, "store init:", err)
		os.Exit(1)
	}

	port := "3000"
	addr := "0.0.0.0"
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
		}
	}

	engine := html.New("./templates", ".html")
	engine.Reload(os.Getenv("RL_DEV") != "")

	app := fiber.New(fiber.Config{
		Views:          engine,
		ViewsLayout:    "layout",
		ReadBufferSize: 65536,
	})

	app.Use(recover.New())
	app.Use(logger.New(logger.Config{Format: "${method} ${path} ${status} ${latency}\n"}))

	// Static
	app.Static("/web", "./web")
	app.Static("/themes", "./themes")
	app.Static("/schema", "./schema")

	// Pages
	app.Get("/", pageLanding)
	app.Get("/editor", pageEditor)
	app.Get("/r", pageView)
	app.Get("/login", pageLogin)
	app.Get("/dashboard", requireAuth, pageDashboard)

	// HTMX partials (no layout)
	app.Get("/partials/share-modal", partialShareModal)
	app.Post("/partials/gallery", partialGallery)
	app.Post("/partials/gallery/card/:theme", partialGalleryCard)

	// API
	app.Post("/api/render", apiRender)
	app.Get("/api/themes", apiThemes)
	app.Get("/api/public/:id", apiPublicResume)
	app.Get("/api/me", apiMe)
	app.Get("/api/default-yaml", apiDefaultYAML)
	app.Post("/api/export/html", apiExportHTML)
	app.Post("/api/export/txt", apiExportTxt)
	app.Post("/api/ats", apiATS)

	// User resumes (requires auth)
	app.Get("/api/resumes", requireAuth, apiListResumes)
	app.Get("/api/resumes/:id", requireAuth, apiGetResume)
	app.Post("/api/resumes", requireAuth, apiSaveResume)
	app.Delete("/api/resumes/:id", requireAuth, apiDeleteResume)

	// Auth — logout must be before :provider wildcard
	app.Get("/auth/logout", authLogout)
	app.Get("/auth/:provider", authStart)
	app.Get("/auth/:provider/callback", authCallbackHandler)

	bind := addr + ":" + port
	fmt.Println("resumelang editor →", "http://"+bind)
	if err := app.Listen(bind); err != nil {
		fmt.Fprintln(os.Stderr, "listen:", err)
		os.Exit(1)
	}
}

func requireAuth(c *fiber.Ctx) error {
	if _, ok := sessionUser(c); !ok {
		return c.Redirect("/login?next=" + c.Path())
	}
	return c.Next()
}
