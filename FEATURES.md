# Perigee — Product & Monetization Roadmap

_Last updated: 2026-07-08. Living document — covers the web app (perigeetides.com), the API/MCP server (this repo), the upcoming iOS/Android apps, and the SEO engine that feeds all of them._

---

## 1. Where we are today

**Shipped:**

- Web app: station explorer map, per-station live pages, Tides-by-state pages, astronomy (any point on Earth), guides, activity planner (fishing / boating / surf / beachcombing / photography / coastal living).
- The Weekly Tide: free Sunday email, one station per free plan.
- Developer surface: REST API + MCP server (25 tools), anonymous 30 req/min, free Builder keys at 300 req/min, Pro $19/mo at 3,000 req/min. Dashboard with per-key usage.
- Infra: Next.js on Vercel, PostHog analytics, NOAA CO-OPS + NWS + local astronomy, 6-minute data freshness, PWA manifest already in place.

**The gap:** every paid dollar today is developer-API revenue. The consumer side — the people who will make up 99% of traffic — has nothing to buy. Tide *data* is free everywhere (NOAA, competitors, Google snippets). Nobody will ever pay Perigee for data. They will pay for **personalization, foresight, and delivery**: _my_ spots, _my_ conditions, told to _me_ before I had to look.

**The strategy in one line:** free data + paid convenience, with programmatic SEO as the customer-acquisition machine and mobile apps as the retention/monetization machine.

---

## 2. Pricing architecture (target state)

Four tiers. The cheap consumer tier is the new wedge; the existing $19 API Pro gets folded into a top tier so the ladder reads consumer-first.

| | **Explorer** | **Tide+** ← new cheap tier | **Pro** | **Captain** |
|---|---|---|---|---|
| Price | $0 | **$2.99/mo · $19/yr** | **$7.99/mo · $59/yr** | **$19/mo · $149/yr** |
| Who | Casual lookups | Regulars: one home beach, wants it delivered | Anglers, surfers, boaters, photographers who plan trips | Businesses, charters, marinas, developers |
| Saved spots | 1 | 5 | Unlimited | Unlimited + fleet dashboard |
| Weekly Tide email | 1 station | All spots + **Daily Brief** | All spots + Daily Brief | Team recipients |
| Alerts | — | 3 simple rules (tide/moon) | Unlimited **Smart Alerts** (compound rules, push + email + SMS later) | Alerts + **webhooks** |
| Calendar (ICS) feed | — | 1 station | All spots + activity windows | White-label feeds |
| Activity Scores & Golden Windows | Today only | 3-day outlook | Full 10-day outlook + history | Full |
| Printable PDF tide calendar | — | — | Monthly, branded per spot | White-label (their logo) |
| Ask the Tide (AI) | 3 questions/day | 10/day | Unlimited | Unlimited + API |
| Offline tide tables (mobile) | — | 7 days | Full year, all spots | Full |
| Home-screen widgets (mobile) | Basic | Basic | All widgets + watch complications | All |
| API | 30 req/min anon | 300 req/min key | 300 req/min key | **3,000 req/min, commercial license, priority support** |
| Embeddable web widget | With Perigee backlink | With backlink | With backlink | **White-label, no backlink** |

Pricing mechanics:

- **Annual-first presentation** ($19/yr reads like "one bait-shop trip"). Annual = ~45% discount, kills churn seasonality (nobody surfs in January; annual keeps them).
- **7-day free trial of Pro** on signup; downgrade path lands on Tide+, not free — the classic "keep the daily brief for $2.99" save-offer.
- **Founder pricing**: first 500 subscribers lock their rate for life. Creates urgency, seeds testimonials.
- Web checkout via Stripe; mobile via StoreKit/Play Billing through RevenueCat so entitlements are shared web↔mobile from day one.
- Keep the promise on the current pricing page: *looking* stays free forever. We charge for delivery, computation, and personalization — never for the gauge reading.

Why a $2.99 tier works here: the marginal cost of an email/alert subscriber is near zero (NOAA data is free, alert evaluation is a cron), so even tiny ARPU is nearly all margin, and Tide+ subscribers are the warm pool that upgrades to Pro when they hit the 3-alert / 5-spot ceiling — the ceilings ARE the upgrade funnel.

---

## 3. Features that convert (build in this order)

### 3.1 Accounts + Saved Spots (prerequisite, weeks 1–2)
Email magic-link + OAuth. A "spot" = station + nickname + activity + optional notes/offset ("the sandbar drains 40 min after the gauge"). Everything below hangs off spots. Free = 1 spot to force the first upgrade decision.

### 3.2 Smart Alerts engine (the #1 converter)
Compound, plain-English rules evaluated against predictions + live obs + forecast:

- "Daylight low tide below 0.0 ft this weekend" (tidepooling/clamming)
- "Morning outgoing tide + wind under 10 kn + new-moon week" (fishing)
- "Water level within 1 ft of flood threshold at my dock" (coastal homeowner — uses our HTF/flood-threshold data, which almost no competitor surfaces)
- "King tide coming in the next 14 days" (photographers, flood-aware residents)

Delivery: email now, web push next, native push with the apps, SMS as a Pro add-on later. Every alert email footer: "Perigee watched the gauge so you didn't have to." Alerts are a *retention* feature disguised as acquisition — an active alert is a reason not to cancel.

### 3.3 Daily Brief (the cheap tier's whole reason to exist)
The Weekly Tide, but daily, per-spot, and smarter: tonight's tide curve sparkline, tomorrow's windows, moon, sunrise, wind, one plain-English sentence ("Best window: 6:40–9:10 AM, falling water into a 0.3 ft low just after sunrise"). This is the product for $2.99. It's a template + cron over data we already have.

### 3.4 Activity Scores + Golden Windows
Turn the existing activity planner from adjectives into numbers: a 0–100 score per activity per day per station (tide movement × daylight overlap × wind × moon × water temp). Show the *why* behind every score (trust). Free users see today; paid see the 10-day outlook.

- Doubles as SEO surface: "Best fishing days in Charleston this week" pages, updated daily (see §5).
- Doubles as share surface: auto-generated score card images (OG images) people post to fishing groups.

### 3.5 Tide Calendar sync (ICS) — cheapest high-value feature we can ship
A subscribable calendar feed: highs/lows/golden windows/king tides appear in Google/Apple Calendar. ~2 days of work, feels like magic, and it's a *silent daily brand impression inside their calendar*. Tide+ gets 1 station, Pro gets everything.

### 3.6 Printable monthly PDF tide calendar
Marinas, bait shops, surf shops, and beach rentals pin these to walls. Pro renders branded per-spot PDFs; Captain gets white-label (their logo). Every printed calendar has a QR code back to the station page → offline-to-online acquisition loop.

### 3.7 Ask the Tide (AI) — our unfair advantage
We already run a production MCP server with 25 tools. Put a chat box on every station page: "Can I walk to the sandbar Saturday afternoon?" → LLM + our MCP tools → grounded answer with the chart to prove it. Nobody else in this niche can ship this credibly. Quota-gated by tier (3/10/unlimited per day). Also the best possible demo of the developer product — every answer footer: "Built on the Perigee API + MCP."

### 3.8 Embeddable widget (growth flywheel, not revenue)
Free JS embed of a station's tide chart for any site — *with a "Tides by Perigee" backlink*. Surf shops, HOAs, marina sites, town tourism pages embed it → thousands of dofollow backlinks → domain authority → SEO compounding. Captain tier removes the backlink (white-label). This is how WeatherWidget/Windy grew; it works.

### 3.9 King Tide & Coastal Flood watch (unique positioning)
We already serve HTF counts, sea-level trends, flood thresholds, and top-ten water levels — data competitors ignore. Package it: a per-station "Flood outlook" tab, king-tide season calendars, and homeowner alerts. This audience (coastal property owners) is older, wealthier, year-round (no seasonality), and *nobody is serving them*. Also catnip for local journalists → press backlinks.

### 3.10 Solunar fishing forecast
Moon phase/transit-based feeding-period predictions layered onto the fishing score. The fishing audience is the biggest and most willing to pay in this whole space (see FishBrain, $70+/yr). We have the astronomy engine already.

### 3.11 Historical explorer (Pro)
"This day last year," storm-event lookbacks, records, monthly means, sea-level trend charts per station. Anglers keep logs; researchers and consultants pay for convenience.

---

## 4. iOS & Android (the retention + monetization machine)

Phased so the web funds it and nothing is built twice:

**Phase 0 — now, ~1 week:** PWA hardening. Manifest exists; add offline caching of saved spots + web push notifications. This *is* the mobile MVP and it makes alerts real without app-store friction.

**Phase 1 — after Tide+ ships web-side:** React Native + Expo single codebase, hitting the same Perigee REST API (dogfooding the paid product). RevenueCat for subscriptions so web Stripe and store billing share one entitlement system. App is free; tiers unlock exactly as on web.

**Phase 2 — the features that only make sense native (and sell Pro):**

- **Home-screen widgets** (the killer mobile feature for this category: next high/low + curve at a glance — it's why people keep tide apps installed for years)
- **Live Activities / Dynamic Island** (iOS): countdown to next low tide while you're at the beach
- **Apple Watch complication + WatchOS app** (surfers/paddlers check watches, not phones)
- **Offline tide tables** for a full year, all spots (boaters lose signal — this alone sells Pro)
- **Geofenced brief**: arrive near the coast → push "You're near Nauset. Low tide in 2 h 10 m."
- Android widgets + Wear OS equivalents.

**ASO:** the app stores are their own search engines — "tide chart," "tide times," "king tide" as keyword targets; screenshots led by the widget, not the map.

---

## 5. The SEO engine (this is the customer-acquisition machine)

Tide queries are the perfect programmatic-SEO target: enormous aggregate volume, thousands of location long-tails, weak/dated incumbents (usharbors, tide-forecast, tides4fishing), and we have fresher data + better UX + real-time observations they lack. The plan, in priority order:

### 5.1 Deepen the station pages (already started with /tides)
Every station gets a hub + spokes, each targeting its own query family:

- `/tides/{state}/{station}` — "tide chart {place}", today + 7 days, live obs, chart. **Hub.**
- `…/calendar/{year}-{month}` — "tide chart {place} March 2027", the printable-calendar query family; also the PDF upsell surface.
- `…/fishing` — "best time to fish in {place}" (activity score + solunar).
- `…/king-tides` — "king tides {place} {year}" (seasonal spike traffic, near-zero competition).
- `…/water-temperature` — "water temp {place}" (huge summer volume, we have live sensors).
- `…/sunrise-sunset` and `…/moon` — astronomy long-tails tied to a coastal place.

~3,300 stations × 6–8 spokes ≈ **20–25k indexable, genuinely useful pages**, all ISR-rendered daily so freshness signals stay hot.

### 5.2 Place pages (the biggest untapped multiplier)
People don't search for stations; they search for **beaches and towns** — most of which have no gauge. Build a coastal-places dataset (GNIS/OSM: beaches, inlets, harbors, towns) mapped to nearest station + prediction offsets: `/tides/{state}/places/{place}` → "tide chart Ocean City MD" even though the gauge is in Lewes. 20–50k more pages, each honest about its source station. This is exactly the client-side Haversine capability the MCP server already has.

### 5.3 Fresh "answer" pages
- `/tides/{state}/{station}/today` — "low tide today near me/{place}" — regenerated daily, FAQ-schema'd ("What time is low tide in X today?" is a featured-snippet goldmine).
- Weekly digests per region: "Best low-tide mornings on Cape Cod this week" — auto-written from scores, also fed to the newsletter (one pipeline, two channels).

### 5.4 Editorial guides hub (E-E-A-T + internal-link mesh)
Expand /guides deliberately: how to read a tide chart · what is a king tide · negative tides & tidepooling · tides for surf fishing · spring vs neap · why tides differ from predictions (we can show *live* divergence — unique) · datum explainers (MLLW vs MSL). Each guide internal-links to live station examples; each station page links back to relevant guides.

### 5.5 Technical & authority checklist
- JSON-LD everywhere: `Dataset` + `FAQPage` + `BreadcrumbList` on station/place pages (WebSite/Organization already done ✓).
- Segmented sitemaps (stations / places / calendars / guides) with real lastmod.
- Core Web Vitals: keep station pages static-first, chart hydrates late.
- Backlink engines: the embeddable widget (§3.8), the free PDF calendars (marinas link to them), king-tide/flood data for local press, an annual "State of the Tides" data report (sea-level trends per state — journalists love it).
- OG share cards per station per day (auto-generated tide-curve image) so every share is a mini-billboard.
- Email capture on every page (already good ✓) — SEO visitor → newsletter → daily-brief upsell is *the* funnel.

### 5.6 Measurement
PostHog is already wired: track funnel = organic landing → spot saved → email joined → trial → paid, per landing-page template, so we double down on whichever page family actually converts (bet: /fishing and /today pages).

---

## 6. Revenue model (order-of-magnitude sanity check)

Illustrative steady-state after the SEO engine matures (~12–18 mo):

| Stage | Rate | Result |
|---|---|---|
| Organic visits/mo | — | 300k (25k pages × modest avg) |
| → email list | 2% | 6k new subscribers/mo |
| → paid (Tide+/Pro blend ≈ $4.50/mo avg) | 4% of list over time | ~10–15k subs at maturity |
| Consumer MRR | — | **$45–65k** |
| Captain/API/white-label | 100–200 accounts | +$2–4k MRR |
| Seasonality hedge | annual plans + flood-watch audience | smooths the winter dip |

The point isn't the exact numbers — it's that **every layer is compounding** (pages → links → authority → more pages rank) and **marginal cost per subscriber is ~zero**, so the business works even at fractions of these rates.

---

## 7. Build order (what to do Monday)

**Phase 1 — Monetization foundation (weeks 1–6)**
1. Accounts + saved spots
2. Stripe + tier gating (ship Tide+ at $2.99/$19 with founder pricing)
3. Daily Brief email + ICS calendar feed
4. Alerts v1 (3 rule templates, email delivery)
5. SEO: station calendar + `/today` spokes, JSON-LD, segmented sitemaps

**Phase 2 — Differentiation (weeks 6–14)**
6. Activity Scores + Golden Windows (+ score OG cards)
7. Place pages dataset + rollout
8. King Tide / Flood watch pages + alerts
9. Embeddable widget with backlink
10. PWA push + offline; Pro tier fully lit up; PDF calendars

**Phase 3 — Mobile + moats (months 4–9)**
11. Expo app (iOS+Android) with RevenueCat, widgets first
12. Watch complication, Live Activities, offline year tables, geofenced brief
13. Ask the Tide (AI on the MCP server)
14. White-label widget + fleet dashboard (Captain), webhooks

**What this repo (MCP/API server) needs to support it**
- Alert-evaluation worker (cron over predictions/obs per saved rule) + webhook dispatch
- Derived endpoints: activity score, daylight-window computation, king-tide detection (perigean spring tide flagging — we literally named the product this), ICS rendering
- Coastal-places → nearest-station dataset endpoint (extends the existing Haversine directory search)
- Precompute/edge-cache layer for the 25k SEO pages so NOAA never rate-limits us at render time
- Entitlement checks per key/tier shared with the web app

---

## 8. Principles (so we don't drift)

1. **Never charge for the gauge reading.** Charge for delivery, computation, personalization. This keeps NOAA-data goodwill and the free SEO surface maximal.
2. **Every paid feature must save the user a glance.** If they'd have opened the site anyway, it's a free feature.
3. **Every free feature must either rank, capture an email, or earn a backlink.** Otherwise it's a paid feature.
4. **"Not for navigation" stays on everything.** Safety disclaimer is non-negotiable, including in alerts and AI answers.
5. **One data plane.** Web, mobile, email, widgets, and AI all consume the same public API this repo serves — we are our own biggest customer.
