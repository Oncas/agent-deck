package buildinfo

import (
	"runtime/debug"
	"strings"
)

// Set at build time with -ldflags -X. Version comes from scripts/version.sh:
// a release such as 1.2.3, or a dev build such as 1.2.3-dev+abc1234.
var (
	Version    = ""
	CommitDate = ""
)

type Info struct {
	Version    string `json:"version"`
	CommitDate string `json:"commit_date"`
}

func Current() Info {
	info := Info{
		Version:    clean(Version),
		CommitDate: dateOnly(CommitDate),
	}

	if bi, ok := debug.ReadBuildInfo(); ok {
		for _, setting := range bi.Settings {
			if setting.Key == "vcs.time" {
				if info.CommitDate == "" {
					info.CommitDate = dateOnly(setting.Value)
				}
			}
		}
	}

	return info
}

// Summary is the --version output: "1.2.3 (2026-10-05)", or whichever of the
// two is known.
func Summary() string {
	info := Current()
	switch {
	case info.Version != "" && info.CommitDate != "":
		return info.Version + " (" + info.CommitDate + ")"
	case info.Version != "":
		return info.Version
	default:
		return valueOrUnknown(info.CommitDate)
	}
}

func clean(value string) string {
	value = strings.TrimSpace(value)
	if value == "<nil>" {
		return ""
	}
	return value
}

func dateOnly(value string) string {
	value = clean(value)
	if len(value) >= 10 {
		return value[:10]
	}
	return value
}

func valueOrUnknown(value string) string {
	if clean(value) == "" {
		return "unknown"
	}
	return value
}
