# sentinelai-frontend

The Angular read-only surface for SentinelAI (SEC-42). Shows each candidate exploit chain, its
steps, the evidence behind each step, and how much of it can be trusted.

The app lives in [`Ui/`](Ui).

---

## Run it

```bash
cd Ui
npm install
npm start
```

Then open <http://localhost:4200>. It runs against the reference fixture's audit by default —
no backend, no database, no scanned repository needed.

To point it at a real backend, set `useDemoData: false` in
[`Ui/src/app/core/config/environment.ts`](Ui/src/app/core/config/environment.ts) and start the
API on `https://localhost:7001` (or change the target in
[`Ui/proxy.conf.json`](Ui/proxy.conf.json)). Requests go to same-origin `/v1/...` and the dev
proxy forwards them, so the JWT never crosses an origin and the API needs no CORS setup.

```bash
npm test          # vitest
npm run build     # production build
```

---

## What it shows

| Route | What it is |
|---|---|
| `/login` | Sign in. Everything else is behind a guard. |
| `/` | Open a report by id, or the reference fixture's audit. |
| `/reports/:id` | The draft audit: summary, candidate chains, refuted chains, citations. |

Each chain renders as a vertical path rather than a table, because the ordering *is* the
content — a chain is a claim about reaching something. The join confidence sits on the
connector between two hops, not inside a hop, since that is what it describes: the step, not
the thing stepped onto.

## Three things this screen must not get wrong

1. **The draft framing.** What the backend produces is a set of candidate chains a debate
   argued over — not a verdict, and not a proven exploit. The banner is not collapsible, and
   the disclaimer is repeated in the footer so it survives a screenshot of one chain.
2. **Confidence tiers.** `certain`, `inferred` and `unresolved` are separated by hue rather
   than by heat, because `unresolved` is not "worse" than `inferred` — it means something
   different. Each badge carries its meaning on hover.
3. **Partial validation stays partial.** A chain where Blue accepted three of five hops says
   exactly that. Rounding it up to "validated" is the most expensive lie this screen could
   tell, and a test pins it.

## It only displays

There is no method in [`ScanApi`](Ui/src/app/core/api/scan-api.ts) that starts a scan, runs a
stage, or purges anything, and no route that could. All reasoning happens in the backend — a UI
that could trigger analysis is one that will eventually be asked to interpret it too.

## Structure

```
Ui/src/app/
  core/
    api/wire.ts          the read API's shapes, transcribed exactly (SEC-40)
    api/scan-api.ts      every call the screen makes; swaps to demo data behind one flag
    api/demo-data.ts     the reference fixture's audit, in real wire shapes
    auth/                session, bearer interceptor, route guard
    config/              environment flags
  features/
    login/               sign in
    home/                open a report by id
    report/              the draft audit, chain cards, confidence badges
```

`wire.ts` uses snake_case property names because that is what the backend sends — the read DTOs
carry explicit `[JsonPropertyName]` attributes. There is deliberately no camelCase mapping
layer: a mapper is a second place for the shape to live, and the failure it produces is a
silently `undefined` field that renders as an empty cell rather than an error.
