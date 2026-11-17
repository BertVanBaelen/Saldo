package ledger

import (
	"strings"
	"testing"
)

// reportBase is made from visibleTx by a text replacement, which does nothing
// when visibleTx is reworded: say so here instead of silently losing the
// materialised tx of the report queries.
func TestReportBaseMaterialisesTx(t *testing.T) {
	const materialised = "tx AS MATERIALIZED ("
	if !strings.Contains(reportBase, materialised) {
		t.Error("reportBase does not materialise tx: the replacement in reports.go no longer matches visibleTx")
	}
	if strings.Contains(visibleTx, materialised) {
		t.Error("visibleTx materialises tx: Transacties' pages would not stop early any more")
	}
	if !strings.HasSuffix(reportBase, reportParts) || strings.Count(reportBase, "), tx AS") != 1 {
		t.Error("reportBase is not visibleTx plus reportParts")
	}
}
