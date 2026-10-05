package buildinfo

import "testing"

func TestSummaryShowsVersionAndCommitDate(t *testing.T) {
	defer func(version, date string) { Version, CommitDate = version, date }(Version, CommitDate)

	Version, CommitDate = "1.2.3", "2026-10-05T12:00:00Z"
	if got := Summary(); got != "1.2.3 (2026-10-05)" {
		t.Fatalf("Summary() = %q", got)
	}
	Version, CommitDate = "1.2.3-dev+abc1234", ""
	if got := Current().Version; got != "1.2.3-dev+abc1234" {
		t.Fatalf("Current().Version = %q", got)
	}
}
