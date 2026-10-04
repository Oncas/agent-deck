package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"agentdeck/internal/buildinfo"
	"agentdeck/internal/config"
	"agentdeck/internal/pty"
	"agentdeck/internal/scanner"
	"agentdeck/internal/server"
)

//go:embed static
var staticFiles embed.FS

func main() {
	host := flag.String("host", "127.0.0.1", "host to listen on")
	port := flag.Int("port", 8080, "port to listen on")
	configFlag := flag.String("config", "", "path to config.json")
	devStaticDir := flag.String("dev-static-dir", "", "serve static assets from this directory and enable renderer auto-reload")
	monacoDirFlag := flag.String("monaco-dir", "", "serve Monaco editor assets from this directory")
	sqlFormatterDirFlag := flag.String("sql-formatter-dir", "", "serve SQL formatter browser assets from this directory")
	versionFlag := flag.Bool("version", false, "print build information and exit")
	flag.Parse()

	if *versionFlag {
		fmt.Println(buildinfo.Summary())
		return
	}

	configPath := *configFlag
	if configPath == "" {
		configPath = configFilePath()
	}

	cfg, err := config.Load(configPath)
	if err != nil {
		// No config yet — start with empty config; setup screen will handle it
		cfg = &config.Config{}
	}

	var projects []scanner.Project
	if len(cfg.ScanPaths) > 0 || len(cfg.ExtraProjects) > 0 {
		projects, _ = scanner.Scan(cfg.ScanPaths, cfg.ExtraProjects)
	}

	manager := pty.NewManager()
	manager.SetCLI(cfg.CLI)
	manager.SetCLIIntegrations(cfg.CLIIntegrations)
	manager.SetStartupGitPullFFOnly(cfg.StartupGitPullFFOnly)
	manager.SetDangerousPermissions(cfg.DangerousPermissions)
	manager.StartStatusProbe(time.Second)

	var staticFS fs.FS
	devMode := *devStaticDir != ""
	if devMode {
		staticDir, err := filepath.Abs(*devStaticDir)
		if err != nil {
			log.Fatal(err)
		}
		if _, err := os.Stat(filepath.Join(staticDir, "index.html")); err != nil {
			log.Fatalf("dev static dir must contain index.html: %v", err)
		}
		staticFS = os.DirFS(staticDir)
		log.Printf("Serving static files from disk: %s", staticDir)
	} else {
		staticFS, err = fs.Sub(staticFiles, "static")
		if err != nil {
			log.Fatal(err)
		}
	}

	var monacoFS fs.FS
	if *monacoDirFlag != "" {
		monacoDir, err := filepath.Abs(*monacoDirFlag)
		if err != nil {
			log.Fatal(err)
		}
		if _, err := os.Stat(filepath.Join(monacoDir, "loader.js")); err != nil {
			log.Fatalf("monaco dir must contain loader.js: %v", err)
		}
		monacoFS = os.DirFS(monacoDir)
		log.Printf("Serving Monaco editor assets from disk: %s", monacoDir)
	}

	var sqlFormatterFS fs.FS
	if *sqlFormatterDirFlag != "" {
		sqlFormatterDir, err := filepath.Abs(*sqlFormatterDirFlag)
		if err != nil {
			log.Fatal(err)
		}
		if _, err := os.Stat(filepath.Join(sqlFormatterDir, "sql-formatter.min.js")); err != nil {
			log.Fatalf("sql formatter dir must contain sql-formatter.min.js: %v", err)
		}
		sqlFormatterFS = os.DirFS(sqlFormatterDir)
		log.Printf("Serving SQL formatter assets from disk: %s", sqlFormatterDir)
	}

	srv := server.New(configPath, cfg, projects, staticFS, monacoFS, sqlFormatterFS, manager, *host, devMode)

	addr := net.JoinHostPort(*host, strconv.Itoa(*port))
	httpSrv := &http.Server{
		Addr:              addr,
		Handler:           srv.Handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		log.Println("Shutting down...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := httpSrv.Shutdown(shutdownCtx); err != nil {
			log.Printf("HTTP shutdown error: %v", err)
		}
	}()

	log.Printf("Agent Deck listening on http://%s", addr)
	err = httpSrv.ListenAndServe()
	srv.API.Docker().StopAll()
	manager.CloseAll()
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func configFilePath() string {
	exe, err := os.Executable()
	if err != nil {
		return "config.json"
	}
	return filepath.Join(filepath.Dir(exe), "config.json")
}
