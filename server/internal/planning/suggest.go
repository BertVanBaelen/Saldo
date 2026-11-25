package planning

// SuggestCategories suggests a category for each confirmed expense or saving
// item (plan 0.9.1-3, decision 10): the item id maps to the own category
// (a subcategory or a top one) that most of the item's matched, booked
// payments carry, among the rows the forecast loads. It runs the forecast's
// own match pass, so it is pure and viewer-free like Project. Only parts that
// fit the kind count: a variable (expense) part for an expense item, a saving
// part for a saving item. Parts are counted, not amounts (a split of 30 and 10
// is a tie); a tie goes to the category on the newest row, then to the lower id.
// An item without a fitting payment has no entry.
func SuggestCategories(f Facts, today string) map[int64]int64 {
	type vote struct {
		n    int
		last string // the date of the newest row that voted
	}
	pass := fcMatch(f, today, fcAddMonths(today[:7], 3)) // Project's shortest horizon: the same matches
	votes := map[int64]map[int64]vote{}                  // item id, category id
	for _, oc := range pass.occs {
		it := f.Items[oc.item]
		if oc.row < 0 || pass.rows[oc.row].Pending || it.Kind != "expense" && it.Kind != "saving" {
			continue
		}
		r := pass.rows[oc.row]
		for _, p := range r.Parts {
			if p.Own == 0 || it.Kind == "expense" && !p.Variable || it.Kind == "saving" && !p.Saving {
				continue
			}
			if votes[it.ID] == nil {
				votes[it.ID] = map[int64]vote{}
			}
			v := votes[it.ID][p.Own]
			votes[it.ID][p.Own] = vote{n: v.n + 1, last: max(v.last, r.Date)}
		}
	}
	out := map[int64]int64{}
	for item, byCategory := range votes {
		var best int64
		var top vote
		for c, v := range byCategory {
			if v.n > top.n || v.n == top.n && (v.last > top.last || v.last == top.last && c < best) {
				best, top = c, v
			}
		}
		out[item] = best
	}
	return out
}
