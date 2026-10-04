package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLocalRequestsOnly(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		host       string
		listenHost string
		headers    map[string]string
		wantStatus int
	}{
		{name: "app page posts to its own server", method: http.MethodPost, host: "127.0.0.1:41234",
			headers: map[string]string{"Origin": "http://127.0.0.1:41234", "Sec-Fetch-Site": "same-origin"}, wantStatus: http.StatusOK},
		{name: "electron loads the page", method: http.MethodGet, host: "127.0.0.1:41234",
			headers: map[string]string{"Sec-Fetch-Site": "none"}, wantStatus: http.StatusOK},
		{name: "curl without origin", method: http.MethodPost, host: "127.0.0.1:41234", wantStatus: http.StatusOK},
		{name: "localhost name", method: http.MethodGet, host: "localhost:8080", wantStatus: http.StatusOK},
		{name: "ipv6 loopback", method: http.MethodGet, host: "[::1]:8080", wantStatus: http.StatusOK},
		{name: "other site posts a simple request", method: http.MethodPost, host: "127.0.0.1:41234",
			headers: map[string]string{"Origin": "https://evil.example", "Content-Type": "text/plain"}, wantStatus: http.StatusForbidden},
		{name: "other site flagged by fetch metadata", method: http.MethodPost, host: "127.0.0.1:41234",
			headers: map[string]string{"Sec-Fetch-Site": "cross-site"}, wantStatus: http.StatusForbidden},
		{name: "other localhost port is same-site, not same-origin", method: http.MethodGet, host: "127.0.0.1:41234",
			headers: map[string]string{"Sec-Fetch-Site": "same-site"}, wantStatus: http.StatusForbidden},
		{name: "other localhost port origin", method: http.MethodDelete, host: "127.0.0.1:41234",
			headers: map[string]string{"Origin": "http://127.0.0.1:3000"}, wantStatus: http.StatusForbidden},
		{name: "opaque origin", method: http.MethodPost, host: "127.0.0.1:41234",
			headers: map[string]string{"Origin": "null"}, wantStatus: http.StatusForbidden},
		{name: "dns rebinding host", method: http.MethodGet, host: "evil.example:41234", wantStatus: http.StatusForbidden},
		{name: "missing host", method: http.MethodGet, host: "", wantStatus: http.StatusForbidden},
		{name: "configured lan host", method: http.MethodGet, host: "192.168.1.20:8080", listenHost: "192.168.1.20", wantStatus: http.StatusOK},
		{name: "wildcard listen host does not widen hosts", method: http.MethodGet, host: "evil.example:8080", listenHost: "0.0.0.0", wantStatus: http.StatusForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reached := false
			handler := localRequestsOnly(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				reached = true
			}), tt.listenHost)
			req := httptest.NewRequest(tt.method, "/api/projects/proj/pull", strings.NewReader(`{}`))
			req.Host = tt.host
			for key, value := range tt.headers {
				req.Header.Set(key, value)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if reached != (tt.wantStatus == http.StatusOK) {
				t.Fatalf("handler reached = %v with status %d", reached, rec.Code)
			}
		})
	}
}
