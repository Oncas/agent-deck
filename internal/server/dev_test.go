package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
	"time"
)

func TestStaticReloadStampChangesWithStaticFiles(t *testing.T) {
	firstMod := time.Unix(100, 0)
	secondMod := time.Unix(200, 0)

	first := fstest.MapFS{
		"index.html": {Data: []byte("one"), ModTime: firstMod},
		"app.js":     {Data: []byte("console.log(1);"), ModTime: firstMod},
	}
	second := fstest.MapFS{
		"index.html": {Data: []byte("one"), ModTime: firstMod},
		"app.js":     {Data: []byte("console.log(2);"), ModTime: secondMod},
	}

	firstStamp, err := staticReloadStamp(first)
	if err != nil {
		t.Fatalf("first stamp: %v", err)
	}
	secondStamp, err := staticReloadStamp(second)
	if err != nil {
		t.Fatalf("second stamp: %v", err)
	}

	if firstStamp == secondStamp {
		t.Fatalf("stamp did not change: %q", firstStamp)
	}
}

func TestDevStaticHandlerDisablesCaching(t *testing.T) {
	handler := newStaticHandler(fstest.MapFS{
		"index.html": {Data: []byte("<!doctype html>")},
	}, true)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/index.html", nil)
	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
}
