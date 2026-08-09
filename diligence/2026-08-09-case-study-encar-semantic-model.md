# Case study: reverse-engineering a site's semantic model, not just its endpoint

Deeper than the pattern study from earlier -- this documents the *domain
model* underneath Encar (Korean used-car marketplace), extracted from the
user's own working wrapper (`autokoreablendi`, not part of Xapi). No new
requests were made against encar.com to produce this -- it's a read of
already-existing, already-legitimate code, written up as a template for
how to do this kind of study for other "bigger projects" going forward.

## Why this is a different kind of entry

Every other diligence entry in this log answers "does this repo do what it
claims." This one answers a different question: "what is the actual shape
of the data and query language a reverse-engineered integration is built
on." That's a reusable skill independent of any one target -- worth a
node in the knowledge graph on its own, not folded into a single repo's
verdict.

## Encar's semantic model, as reverse-engineered

**Facet taxonomy.** Encar's search API expects filter values in Korean,
not the English/Albanian labels a consumer-facing UI would show. The
wrapper maintains five translation tables to bridge that:
`MANUFACTURER_REVERSE` (English brand -> Korean facet value, e.g.
`BMW -> BMW` but `Mercedes-Benz -> 벤츠`), `MODEL_REVERSE`,
`FUEL_MAP` (Albanian/English -> Korean, e.g. `dizel -> 디젤`),
`TRANSMISSION_MAP`, `COLOR_MAP`. This is the actual reverse-engineering
work -- not the HTTP call, but recovering the enum *values* a closed API
expects, one facet at a time, by observing real responses.

**Query grammar.** The search endpoint (`api.encar.com/search/car/list/general`)
takes a `q` parameter that is its own small boolean-filter DSL, not a flat
set of query-string params:

```
(And.Hidden.N._.SellType.일반._.Condition.Inspection._.<facet>.<value>._....)
```

-- an `And`-rooted, `._.`-delimited chain of `Facet.Value` pairs, wrapped
in parens. Every additional filter (manufacturer, model, fuel, year range,
price range) is another segment appended to that same chain. This is the
kind of detail that only shows up from reading a real implementation, not
from a site's public docs (there are none) -- worth capturing explicitly
because query-DSL shape is exactly the part that breaks silently if
guessed at instead of observed.

**Business-logic layer on top of the raw data**, independent of Encar
itself but relevant to judging "does this wrapper do something real":
a `qualityScore()` heuristic ranks listings for a homepage feed (recency,
low mileage, "featured" luxury brands, a price band matched to the target
market's actual buying power -- ~€8k-25k, not the full range Encar
carries), and a documented, evidenced exclusion of a specific placeholder
price value (201만원 floor, because exactly 200만원 turned out to be a
"call for price" placeholder shared by ~80 unrelated listings -- found by
checking real data, not assumed).

## Why this belongs in the KG as its own node

The value isn't "here's how Encar works" (narrow, decays if Encar changes
its API). It's the *method*: recover facet-value enums from observed
responses, recover the query grammar from real requests, and separate the
platform's raw data from the wrapper's own business logic on top of it.
That method transfers directly to the next "bigger project" -- same three
questions (what are the facet values, what's the query grammar, what's
platform data vs. wrapper logic) apply regardless of target.

## Category graph

Filed under a new top-level node, `semantic-api-reverse-engineering`,
distinct from `reverse-engineered-api-wrapper` (the pattern-study node) --
that one is about the *access* pattern (multi-proxy fallback, browser
headers); this one is about the *data model* recovered once access works.
Both are real, both recur, and conflating them would lose the distinction
between "how do you reach it" and "what do you find once you're there."
