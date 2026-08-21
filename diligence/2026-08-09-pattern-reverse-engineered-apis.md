# Pattern study: reverse-engineered public API wrappers

Different from the other entries in this log -- not a single repo's
verdict, but a technique writeup, prompted by a request to understand how
an existing project (the user's own Korean-car-listings site) wraps a
site that has no official API, and to look at how others solve the same
problem.

## The reference implementation: encar.com wrapper

The user's own project (`autokoreablendi`, a Vercel-hosted site + API,
separate repo from Xapi) re-presents Encar (a Korean used-car marketplace)
listings for an Albanian-market audience -- translated fuel/transmission/
color/brand facets, EUR pricing. Encar has no public developer API, so it
calls the same JSON endpoint Encar's own web frontend calls
(`api.encar.com/search/car/list/general`) directly, with browser-shaped
headers (`User-Agent`, `Referer: https://www.encar.com/`,
`Origin: https://www.encar.com`) so the request looks like normal frontend
traffic rather than a bot. When a direct call gets blocked, it falls back
through third-party CORS-relay services (`corsproxy.io`,
`api.codetabs.com/v1/proxy`) as alternate paths to the same endpoint --
that's the "multiproxy" part: not owned/rotating IP infrastructure, but a
short ordered list of fallback relays tried in sequence until one works.

This is a legitimate, common pattern -- calling a site's *own* public
frontend API (not an internal/authenticated backend), for a genuinely
different downstream use (translation + currency conversion for a market
the source site doesn't serve), not bulk-repackaging/reselling the
original data as-is. Worth being precise about that distinction, since
"reverse-engineered API wrapper" as a category spans everything from this
(benign) to actual ToS-violating scraping of authenticated/private data
(not benign) -- the technique looks identical in both cases; what differs
is what's being accessed and why.

## Real GitHub examples tested against this pipeline

Sourced via GitHub search for "unofficial"/"reverse engineered" API
clients, then run through the same sanity -> classify -> smoke tiers as
every other entry in this log:

- `rohitaryal/imageFX-api` (129★, TypeScript, MIT) -- reverse-engineered client for Google Labs' ImageFX.
- `0xtbug/unofficial-pddikti-api` (66★, Go, no license) -- wraps Indonesia's national higher-education database (a *public government data* API with no official client -- a clean, unambiguous case: public data, no auth bypass).
- `xob0t/google_photos_web_client` (33★, Python, MIT) -- reverse-engineered Google Photos *web* API client -- notably closer to the sensitive end: this one operates against an authenticated personal-account surface, not a public dataset like the two above.
- `nikitaxru/tbank-mobile-api` (16★, Python, MIT) -- reverse-engineered from a banking app's mobile API traffic -- the most sensitive category tested tonight (financial account access); included specifically to see how the pipeline's own claims-extraction handles a repo whose entire premise is "this is not authorized by the vendor."

**Update 2026-08-21, checked live:** `imageFX-api`, `google_photos_web_client`,
and `tbank-mobile-api` all reached `smoke:pass` (installs cleanly) and now
have real `category_node_id` leaves via the 2026-08-21 backfill.
`unofficial-pddikti-api` hit `sanity:fail` -- correctly, per its own
description above ("no license"), not a pipeline bug. None reached
`capability` -- this category has no capability-tier fixtures (see "What
this suggests" below), so `smoke:pass` here is the ceiling today and means
what the methodology-corrections entry already warned about: installs, not
"the reverse-engineering actually works as claimed." Building real
capability fixtures for this category is a materially bigger design
problem than the document-parsing-conversion set: those five fixtures are
one shared input format every tool in that category takes, while every
reverse-engineered wrapper here targets a *different* live third-party
site -- there's no single fixture that works across the category, only
per-tool, per-target test design. Flagged, not attempted speculatively.

## What this suggests for the category graph

"Reverse-engineered API wrapper" is a real, recurring shape distinct from
both the money-bait crypto repos and the star-farmed AI-agent repos found
earlier tonight -- worth its own node once enough examples accumulate,
likely with sub-nodes by what's being accessed (public data vs.
authenticated-personal vs. financial/sensitive), since that axis is what
actually determines whether a given instance of the pattern is benign.
