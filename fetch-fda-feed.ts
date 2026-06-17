/**
 * fetch-fda-feed.ts
 *
 * Polls the three FDA RSS feeds, classifies each item against the alert
 * taxonomy, and writes a JSON file the React demo can replay.
 *
 * Usage:
 *   bun add rss-parser
 *   bun run fetch-fda-feed.ts --out demo/fda-events.json --days 90
 *
 * Output schema is consumed by useFdaReplayFeed.jsx.
 */

import Parser from 'rss-parser';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Feeds
// ---------------------------------------------------------------------------

const FEEDS = {
  drugs:    'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/drugs/rss.xml',
  medwatch: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/medwatch/rss.xml',
  press:    'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml',
} as const;

type FeedKey = keyof typeof FEEDS;

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

type AlertCategory =
  | 'REGULATORY_APPROVAL'      // Drug or supplemental approval
  | 'REGULATORY_REJECTION'     // CRL, RTF, refusal
  | 'REGULATORY_DESIGNATION'   // Breakthrough, Fast Track, Priority Review, Orphan
  | 'SAFETY_SIGNAL'            // DSC, boxed warning, label update
  | 'RECALL_WITHDRAWAL'        // Recalls, market withdrawals
  | 'ADCOM_SCHEDULED'          // Advisory committee meetings
  | 'GUIDANCE_DOCUMENT'        // Filtered out by default
  | 'UNCLASSIFIED';

type Direction = 'positive' | 'negative' | 'neutral';
type Materiality = 'high' | 'medium' | 'low';

interface Classified {
  category: AlertCategory;
  direction: Direction;
  materiality: Materiality;
}

function classify(title: string, feed: FeedKey): Classified {
  const t = title.toLowerCase();

  if (/\bcomplete response letter\b|\bcrl\b|refus(e|al) to file|\brtf\b/.test(t))
    return { category: 'REGULATORY_REJECTION', direction: 'negative', materiality: 'high' };

  if (/\bfda approves?\b|\bapproval\b/.test(t) && !/labeling change|over-the-counter/.test(t))
    return { category: 'REGULATORY_APPROVAL', direction: 'positive', materiality: 'high' };

  if (/breakthrough therapy|fast track|priority review|orphan drug|accelerated approval/.test(t))
    return { category: 'REGULATORY_DESIGNATION', direction: 'positive', materiality: 'medium' };

  if (/\brecall\b|withdraw/.test(t))
    return { category: 'RECALL_WITHDRAWAL', direction: 'negative', materiality: 'medium' };

  if (/advisory committee|adcom\b/.test(t))
    return { category: 'ADCOM_SCHEDULED', direction: 'neutral', materiality: 'medium' };

  if (feed === 'medwatch' || /safety communication|boxed warning|warning about|risk of/.test(t))
    return { category: 'SAFETY_SIGNAL', direction: 'negative', materiality: 'medium' };

  if (/\bguidance\b|draft guidance/.test(t))
    return { category: 'GUIDANCE_DOCUMENT', direction: 'neutral', materiality: 'low' };

  return { category: 'UNCLASSIFIED', direction: 'neutral', materiality: 'low' };
}

// ---------------------------------------------------------------------------
// Output schema (consumed by the React replay hook)
// ---------------------------------------------------------------------------

export interface FdaEvent {
  id: string;             // dedup key (item URL)
  source: 'fda-rss';
  feed: FeedKey;
  category: AlertCategory;
  direction: Direction;
  materiality: Materiality;
  title: string;
  summary: string;        // first sentence of contentSnippet, trimmed
  url: string;
  pub_date: string;       // ISO-8601 from FDA
}

// ---------------------------------------------------------------------------
// Fetch + classify
// ---------------------------------------------------------------------------

interface CliArgs { out: string; days: number; includeGuidance: boolean; }

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { out: 'demo/fda-events.json', days: 90, includeGuidance: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) args.out = argv[++i]!;
    else if (argv[i] === '--days' && argv[i + 1]) args.days = Number(argv[++i]);
    else if (argv[i] === '--include-guidance') args.includeGuidance = true;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cutoff = Date.now() - args.days * 24 * 60 * 60 * 1000;

  const parser = new Parser({ timeout: 15_000 });
  const events: FdaEvent[] = [];
  const seen = new Set<string>();

  for (const [feed, url] of Object.entries(FEEDS) as [FeedKey, string][]) {
    process.stderr.write(`fetching ${feed} ... `);
    const parsed = await parser.parseURL(url);
    let kept = 0;
    for (const item of parsed.items) {
      if (!item.link || !item.title || !item.pubDate) continue;
      if (seen.has(item.link)) continue;
      const pubMs = new Date(item.pubDate).getTime();
      if (Number.isNaN(pubMs) || pubMs < cutoff) continue;

      const cls = classify(item.title, feed);
      if (!args.includeGuidance && cls.category === 'GUIDANCE_DOCUMENT') continue;

      seen.add(item.link);
      events.push({
        id: item.link,
        source: 'fda-rss',
        feed,
        ...cls,
        title: item.title.trim(),
        summary: firstSentence((item as { contentSnippet?: string }).contentSnippet ?? ''),
        url: item.link,
        pub_date: new Date(pubMs).toISOString(),
      });
      kept++;
    }
    process.stderr.write(`${kept} items kept\n`);
  }

  // Oldest first — the replay hook walks forward in time.
  events.sort((a, b) => a.pub_date.localeCompare(b.pub_date));

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(events, null, 2));
  process.stderr.write(`wrote ${events.length} events to ${args.out}\n`);
}

function firstSentence(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return '';
  const m = trimmed.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : trimmed).slice(0, 280);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
