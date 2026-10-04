package server

import (
	"net"
	"net/http"
	"strings"
)

// localRequestsOnly rejects requests that a web page other than the app's own
// could have caused. The server listens on loopback, but every site open in a
// browser on this machine runs its JavaScript here too and can reach
// 127.0.0.1, so binding to loopback alone does not stop a page from posting to
// /restart or writing files.
//
//   - The Host header must name a loopback address (or the configured listen
//     host). A DNS-rebinding page reaches the server under its own domain, so
//     this keeps it from reading responses as if it were same-origin.
//   - Browsers label every request with Sec-Fetch-Site. Anything other than
//     "same-origin" or "none" (typed URL, Electron's loadURL) came from another
//     site. Other localhost ports count as "same-site", which is still refused.
//   - State-changing requests must carry an Origin equal to this server's own
//     origin when they carry one at all. Requests with no Origin come from
//     local programs such as curl or Electron's main process, which can already
//     run code on this machine.
func localRequestsOnly(next http.Handler, listenHost string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !allowedRequestHost(r.Host, listenHost) {
			http.Error(w, "forbidden host", http.StatusForbidden)
			return
		}
		switch r.Header.Get("Sec-Fetch-Site") {
		case "", "same-origin", "none":
		default:
			http.Error(w, "cross-site request refused", http.StatusForbidden)
			return
		}
		if !isSafeMethod(r.Method) {
			if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+r.Host {
				http.Error(w, "cross-origin request refused", http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func isSafeMethod(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	default:
		return false
	}
}

func allowedRequestHost(hostport, listenHost string) bool {
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	}
	host = strings.Trim(strings.ToLower(host), "[]")
	if host == "" {
		return false
	}
	if host == "localhost" {
		return true
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return true
	}
	// A specific non-loopback --host (e.g. a LAN address) is reachable under
	// that name. Wildcard binds add nothing: any name would resolve to them.
	listen := strings.Trim(strings.ToLower(strings.TrimSpace(listenHost)), "[]")
	if listen == "" {
		return false
	}
	if ip := net.ParseIP(listen); ip != nil && ip.IsUnspecified() {
		return false
	}
	return host == listen
}
