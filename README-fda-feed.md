# FDA replay feed — wire-up

Three files. Drop them into the demo and you're done.

## Files

- `fetch-fda-feed.ts` — Bun script. Polls the three FDA RSS feeds, classifies
  each item, writes a JSON file. Run it whenever you want to refresh the data.
- `useFdaReplayFeed.jsx` — React hook. Loads the JSON and emits events on a
  cadence. Loops forever by default. Drop into the existing demo alongside
  `vigil-demo.jsx`.
- `fda-events.sample.json` — Handcrafted sample matching the schema the script
  produces. Twelve events across all taxonomy categories. Use this immediately;
  swap for the script's output when you're ready.

## Phase 1 — wire the hook with the sample (5 minutes)

Place `useFdaReplayFeed.jsx` and `fda-events.sample.json` next to `vigil-demo.jsx`.

In the demo:

```jsx
import { useFdaReplayFeed } from './useFdaReplayFeed';
import fdaEvents from './fda-events.sample.json';

function SignalFeedView() {
  const { emitted, isRunning, start, pause, reset, speed, setSpeed } =
    useFdaReplayFeed(fdaEvents, { cadenceMs: 8000, autostart: true });

  // emitted[0] is the newest event. Feed `emitted` (or each new event from
  // `emitted[0]` via a useEffect) into your existing pipeline simulator —
  // classification, enrichment, dedup, delivery stages stay where they are.

  return (/* existing feed UI, rendering `emitted` */);
}
```

Speed control belongs in the demo chrome — useful during pitches when you want
to fast-forward through the queue:

```jsx
<button onClick={() => setSpeed(1)}>1x</button>
<button onClick={() => setSpeed(5)}>5x</button>
<button onClick={() => setSpeed(20)}>20x</button>
```

The hook caps the in-memory feed at 100 items so it doesn't grow during long
demo sessions.

## Phase 2 — swap to real data (10 minutes, one-time)

```bash
bun add rss-parser
bun run fetch-fda-feed.ts --out demo/fda-events.json --days 90
```

This hits the live FDA feeds, classifies each item, and writes
`demo/fda-events.json`. Default window is 90 days. Re-run anytime to refresh.

Then in the demo, swap the import:

```jsx
// import fdaEvents from './fda-events.sample.json';
import fdaEvents from './fda-events.json';
```

To automate refresh, add a cron to GitHub Actions that re-runs the script
weekly and commits the JSON.

## Schema

Each event:

```ts
{
  id: string;            // dedup key (item URL)
  source: 'fda-rss';
  feed: 'drugs' | 'medwatch' | 'press';
  category:
    | 'REGULATORY_APPROVAL'
    | 'REGULATORY_REJECTION'
    | 'REGULATORY_DESIGNATION'
    | 'SAFETY_SIGNAL'
    | 'RECALL_WITHDRAWAL'
    | 'ADCOM_SCHEDULED'
    | 'GUIDANCE_DOCUMENT'   // filtered out by default
    | 'UNCLASSIFIED';
  direction: 'positive' | 'negative' | 'neutral';
  materiality: 'high' | 'medium' | 'low';
  title: string;
  summary: string;
  url: string;
  pub_date: string;       // ISO-8601 from FDA
}
```

When the hook emits an event, it adds two fields:

```ts
{
  ...event,
  emitted_at: string;       // ISO-8601 "now" — makes demo timestamps live
  source_pub_date: string;  // original FDA pub_date, preserved
}
```

## Tuning the classifier

`classify()` in `fetch-fda-feed.ts` is keyword regex. It's deliberate — the FDA
feeds are pre-curated so regex beats an LLM classifier for cost and latency. If
you see misclassifications after running against real data, that function is
the one place to edit. The order of checks matters: rejection checks before
approval checks, because some CRL announcements include the word "approval" in
context.

## Featured-company anchor

The hook emits everything in the feed. If you want a featured-company narrative
(your "replace ACME with a real company"), keep the full feed flowing for
volume but tag one company's events with a `featured: true` flag downstream —
in the pipeline simulator or via a small lookup at emit time. That way the
demo gets a deep-dive panel anchored to one issuer plus the ambient real-feed
ticker showing the system handles the long tail.
