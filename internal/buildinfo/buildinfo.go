package buildinfo

import (
	"runtime/debug"
	"strings"
)

var CommitDate = ""

type Info struct {
	CommitDate string `json:"commit_date"`
}

func Current() Info {
	info := Info{
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

func Summary() string {
	return valueOrUnknown(Current().CommitDate)
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
