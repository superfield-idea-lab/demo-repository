/**
 * useFdaReplayFeed.jsx
 *
 * Drop-in React hook for the vigil demo. Loads a JSON file of pre-classified
 * FDA events and emits them on a controllable cadence, looping forever.
 *
 * Usage in vigil-demo.jsx:
 *
 *   import { useFdaReplayFeed } from './useFdaReplayFeed';
 *   import fdaEvents from './fda-events.json';
 *
 *   function SignalFeedView() {
 *     const { emitted, isRunning, start, pause, reset, speed, setSpeed } =
 *       useFdaReplayFeed(fdaEvents, { cadenceMs: 8000, autostart: true });
 *
 *     // Feed `emitted` into the existing pipeline simulator (e.g. classify →
 *     // enrich → dedupe → deliver). `emitted[0]` is the most recent event.
 *   }
 *
 * Design notes:
 * - Cadence mode (default): one event every cadenceMs / speedMultiplier.
 *   Predictable; no awkward gaps. Best for live pitches.
 * - The hook is intentionally stateless about the pipeline — it just produces
 *   events. Downstream stages (classification, enrichment, dedup, delivery)
 *   stay where they already are in the demo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_CADENCE_MS = 8000;
const MAX_FEED_SIZE = 100;

export function useFdaReplayFeed(events, opts = {}) {
  const {
    cadenceMs = DEFAULT_CADENCE_MS,
    autostart = true,
    loop = true,
    initialSpeed = 1,
  } = opts;

  // Stable sorted copy (oldest first — we walk forward in time).
  const sorted = useMemo(
    () => [...(events ?? [])].sort((a, b) => a.pub_date.localeCompare(b.pub_date)),
    [events],
  );

  const [cursor, setCursor] = useState(0);
  const [emitted, setEmitted] = useState([]); // newest-first
  const [isRunning, setIsRunning] = useState(autostart);
  const [speed, setSpeed] = useState(initialSpeed); // 1, 2, 5, 10 ...

  // Refs to avoid restarting the timer on every emit.
  const cursorRef = useRef(cursor);
  const speedRef = useRef(speed);
  cursorRef.current = cursor;
  speedRef.current = speed;

  // Emit one event and advance.
  const tick = useCallback(() => {
    if (sorted.length === 0) return;
    const idx = cursorRef.current;
    const next = sorted[idx];
    if (!next) {
      if (loop) {
        setCursor(0);
        return;
      }
      setIsRunning(false);
      return;
    }
    setEmitted((prev) => {
      // Re-stamp emission time so the demo timestamps look "now" rather
      // than months old. Preserve original pub_date as source_pub_date.
      const stamped = {
        ...next,
        emitted_at: new Date().toISOString(),
        source_pub_date: next.pub_date,
      };
      const updated = [stamped, ...prev];
      return updated.length > MAX_FEED_SIZE ? updated.slice(0, MAX_FEED_SIZE) : updated;
    });
    setCursor(idx + 1);
  }, [sorted, loop]);

  // Drive the timer. Restarts whenever isRunning or cadence flips, but
  // NOT on every emit (cursor is tracked via ref).
  useEffect(() => {
    if (!isRunning || sorted.length === 0) return undefined;
    const period = Math.max(250, Math.floor(cadenceMs / speedRef.current));
    const handle = setInterval(tick, period);
    return () => clearInterval(handle);
  }, [isRunning, cadenceMs, sorted.length, tick, speed]);

  const start = useCallback(() => setIsRunning(true), []);
  const pause = useCallback(() => setIsRunning(false), []);
  const reset = useCallback(() => {
    setCursor(0);
    setEmitted([]);
  }, []);

  return {
    emitted,
    current: emitted[0] ?? null,
    cursor,
    total: sorted.length,
    isRunning,
    speed,
    setSpeed,
    start,
    pause,
    reset,
  };
}
