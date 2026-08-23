# sentinelai-frontend

The Angular console for SentinelAI. Shows each candidate exploit chain, its steps, the evidence
behind each step, and how much of it can be trusted — plus the ops surface that drives a scan
through the pipeline.

The app lives in [`Ui/`](Ui).

---

## Run it

```bash
cd Ui
npm install
npm start
```

Then open <http://localhost:4200>.

It calls a real backend by default. Requests go to same-origin `/v1/...` and the Angular dev
proxy ([`Ui/proxy.conf.json`](Ui/proxy.conf.json)) forwards them, so the JWT never crosses an
origin and the API needs no CORS setup.

To explore it with no backend at all, set `useDemoData: true` in
[`Ui/src/app/core/config/environment.ts`](Ui/src/app/core/config/environment.ts). Demo mode
returns the reference fixture — its audit, its findings, and its resource graph — in the exact
wire shapes the API sends, so a component cannot behave differently depending on where its data
came from.

```bash
npm test          # vitest
npm run build     # production build
```

---

## What it shows

| Route | What it is |
|---|---|
| `/login`, `/register` | The auth canvas. Everything else is behind a guard. |
| `/` | Console: registered projects, what this browser has opened, and the jump-in-by-id entry points. |
| `/projects` | The repositories this tenant may scan, with the project id built to be copied. |
| `/setup` | Set up CI: the three values `sentinelai.yml` reads, collected in one place — the API URL, a project id, and a machine token minted on the spot. |
| `/scans/new` | Submits a bundle — the multipart upload the GitHub Action normally performs. |
| `/scans/:id/ops` | The pipeline: real stage/status as a stepper, and the stage runners. |
| `/scans/:id/findings` | Every finding on a scan — server-side layer and severity filters, cursor paging. |
| `/scans/:id/graph` | The resource graph, drawn: layer columns, joins coloured by confidence. |
| `/reports/:id` | The draft audit: summary, severity posture, candidate chains, refuted chains, citations. |
| `/debate` | Runs the Red/Blue/Reporter debate directly and renders the transcript. |
| `/pricing` | Plans and FAQ. The only route outside the auth guard. |
| `/billing` | This organisation's subscription, and the hand-off to Stripe. |
| `/account` | Who you are signed in as, the scopes that gate everything, and the delete path. |

Each chain renders as a vertical path rather than a table, because the ordering *is* the
content — a chain is a claim about reaching something. The join confidence sits on the
connector between two hops, not inside a hop, since that is what it describes: the step, not
the thing stepped onto. The resource graph makes the same choice with colour: the tier lives on
the edge.

## Four things this console must not get wrong

1. **The draft framing.** What the backend produces is a set of candidate chains a debate
   argued over — not a verdict, and not a proven exploit. The banner is not collapsible, and
   the disclaimer sits in the shell footer on every route so it survives a screenshot of one
   chain.
2. **Confidence tiers.** `certain`, `inferred` and `unresolved` are separated by hue rather
   than by heat, because `unresolved` is not "worse" than `inferred` — it means something
   different. `unresolved` also carries a dashed border, so the weakest joins survive greyscale
   and colour blindness. Each badge carries its meaning on hover.
3. **Partial validation stays partial.** A chain where Blue accepted three of five hops says
   exactly that. Rounding it up to "validated" is the most expensive lie this screen could
   tell, and a test pins it.
4. **No invented aggregates.** `GET /v1/scans` enumerates this tenant's scans, and `/scans`
   renders them — so the history is served, not invented. What is still refused is a *derived*
   number: the list endpoints expose no total, so there is no "scans this week" tile, because
   counting a page and presenting it as a population is not counting. The findings page counts the
   rows it has loaded, not the scan, for the same reason. What the console remembers separately is
   what *this browser* has opened, and every surface that shows it says so — see
   [`core/history/recents.ts`](Ui/src/app/core/history/recents.ts).

## Scans are read here, not started here

The console registers projects and reviews what the scans found. It does **not** run a scan: the
GitHub Action does that, on a push, inside the customer's own CI.

That is a privacy decision as much as a scoping one. A browser that could start a scan would need
the backend to hold a GitHub credential, and there is nowhere safe to keep one — the backend
documents that encryption at rest is not implemented on its host. Not holding the token is the
guarantee. Nothing in this app calls GitHub, and no repository content is fetched by us.

`/scans/new` still exists for submitting a bundle by hand, which is how the pipeline is driven with
no CI run at all. It is off the navigation and gated on admin — a presentation choice, not an
enforced one: `POST /v1/scans` authorises on the `scan:write` scope, which an analyst also holds,
and it has to stay that way because the Action's machine token carries that scope and no role.

## Billing is built but not switched on

`/pricing` and `/billing` are finished screens against a Stripe integration that does not exist
on the backend yet. Nothing is mocked: while `environment.billing.enabled` is false, every
action that would spend money says billing is unconfigured instead of starting a flow that
cannot finish.

To turn it on:

1. Implement the four endpoints named in
   [`core/api/billing-api.ts`](Ui/src/app/core/api/billing-api.ts) — `GET /v1/billing/subscription`,
   `POST /v1/billing/checkout`, `POST /v1/billing/portal`, and the Stripe webhook receiver.
2. Put the Stripe **Price** ids into [`core/billing/plans.ts`](Ui/src/app/core/billing/plans.ts).
   They are public identifiers, safe to commit — unlike the secret key, which only ever lives
   on the backend.
3. Set `environment.billing.enabled` to true.

Two rules the backend has to hold up, because the frontend cannot:

- **Only the signed webhook may change a plan.** The browser being redirected to
  `?checkout=success` proves nothing — anyone can type that URL. This screen treats the
  redirect purely as a cue to re-read the subscription, and a test pins that.
- **The price id and return URLs arriving from the browser are inputs, not instructions.**
  Check the price against an allow-list, or a caller substitutes the id of a $0 price; check
  the return URL against your own origins, or you have an open redirect.

The browser never touches a card number or a Stripe key: payment happens on Stripe's hosted
Checkout page, which keeps this origin out of PCI scope entirely.

## Structure

```
Ui/src/
  styles.css             imports the three global stylesheets below
  styles/tokens.css      palette, type, shape, motion — what things mean
  styles/base.css        element defaults, page frames, icons, scrollbars, print
  styles/components.css  the shared vocabulary: cards, KPI tiles, chips, buttons, tables, stepper
  app/
    app.*                the shell: top bar, URL-derived breadcrumbs, side nav, standing footer
    core/
      api/wire.ts        the read API's shapes, transcribed exactly (SEC-40)
      api/scan-api.ts    every read the console makes; swaps to demo data behind one flag
      api/scan-ops-api.ts  the write half: submit, run a stage, purge
      api/demo-data.ts   the reference fixture — audit, findings and resource graph
      auth/              session, bearer interceptor, route guard
      history/recents.ts what this browser has opened, keyed by tenant
      config/            environment flags
      billing/plans.ts   the plan catalogue — the one place a price or Stripe id is written
    features/
      auth/              the split brand/form canvas shared by login and register
      home/              the console landing screen
      pricing/           plans, comparison and FAQ (no auth guard)
      billing/           subscription state and the Stripe hand-off
      projects/          registered repositories
      scans/             submit, pipeline ops, findings, resource graph
      report/            the draft audit, chain cards, confidence badges
      debate/            the debate playground and transcript
      account/           identity, scopes, danger zone
```

Component stylesheets hold only what is local to one screen. A chip that means "certain" is
defined once, globally, because it has to look identical on the report, in the graph inspector
and in the findings table — three scoped copies are three chances for them to drift apart.

`wire.ts` uses snake_case property names because that is what the backend sends — the read DTOs
carry explicit `[JsonPropertyName]` attributes. There is deliberately no camelCase mapping
layer: a mapper is a second place for the shape to live, and the failure it produces is a
silently `undefined` field that renders as an empty cell rather than an error.
