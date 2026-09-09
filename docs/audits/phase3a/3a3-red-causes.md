# Phase 3A.3 — RED causes found in shadow mode

Both were found by the shadow comparison and **neither was fixed**, per the
instruction to stop and document rather than patch. Both are **pre-existing**
defects of the legacy read path, surfaced — not caused — by 3A.3.

---

## RED #1 — `callOutcomesBySeller.sellerId` is an auth user id, not a seller id

`attributeCaller()` (lib/dashboard-data.ts) resolves a call to
`dialed_by_user_id → leadToAssignedUser → leadToFlowSellerUser`, all of which
are **auth user ids**, and `callSellerAgg` is keyed by that value. The payload
field is nevertheless named `sellerId`.

`DashboardFilters.sellerIds`, meanwhile, expects `sellers.id`.

Measured (SWL, last 30 days, Lucia):

| filter value | meaning | dashboard result |
|---|---|---|
| `5e5085ca…` | real `sellers.id` | attempted **264** |
| `e96d3622…` | what the payload calls `sellerId` | attempted **0** |

So any caller that takes an id out of the Sellers table and filters by it gets
an empty dashboard. This is why the seller cases have read `made 0` in every
snapshot since Phase 3A.1 — I recorded the zero three times and did not chase
it until the independent verifier disagreed.

**Not fixed.** The fix is a rename plus a mapping at the filter boundary, and
it touches seller attribution, which is out of scope for a Calls-only read
migration.

---

## RED #2 — scope filtering happens per ROW, canonical identity is per CALL

This is the blocking one.

`scopedCalls = allCalls.filter(c => callMatchesScope(c, callScope))` runs
`callOwner()` on **each technical row**. The two rows of one physical call can
resolve to different owners, because attribution data is split across them.

Concrete case, SWL, last 30 days — canonical call `9dc6115b`:

| row | aircall id | dialer | seller_id | classification | `callOwner` |
|---|---|---|---|---|---|
| `5d731f58` (marker) | no | Lucia | Lucia | — | **Lucia** |
| `2341c4bf` (webhook) | yes | — | — | `voicemail` | **Andrea Tizi** |

The webhook has no dialler, so `callOwner` falls through to the lead's
assigned user, who is Andrea. Under a **Lucia** filter only the marker
survives; alone it has no Aircall id and no outcome, so `isReal` is false and
the whole call disappears. Under an **Andrea** filter the same physical call
would be counted as hers.

Result:

```
group-then-attribute (correct) ... Lucia 265
filter-rows-then-group (today) ... Lucia 264
```

This breaks the requirement that one physical call gives the same answer on
every equivalent surface: the unfiltered Sellers table says 265 for Lucia, the
seller-filtered view says 264.

**Not fixed.** The correct shape is to build physical calls first, attribute
per call, and filter the groups — i.e. move `callMatchesScope` after
`canonicalCallGroups()`. That is a change to the scope layer shared with every
other metric, so it needs its own phase and its own reconciliation, not a
patch inside a Calls read migration.

### Why Σ dimensions still reconciled

The `Σ sellers == workspace` checks passed because they are computed from a
**single unfiltered** request, where grouping happens before attribution and
every call lands in exactly one bucket. The defect only appears when a filter
is applied, which is precisely why per-scope reconciliation was necessary and
per-dimension sums were not enough.
