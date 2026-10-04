package server

import (
	"net/http"

	"agentdeck/internal/buildinfo"
)

func (a *apiHandler) handleBuildInfo(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, buildinfo.Current())
}
