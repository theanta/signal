'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Animates a number from 0 → target on mount / when target changes.
 * Respects prefers-reduced-motion (jumps straight to the value).
 * Preserves up to 1 decimal place if the target is fractional.
 */
export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);
  const frameRef = useRef<number | null>(null);
  const fromRef = useRef(0);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (reduce || target === 0) {
      setValue(target);
      return;
    }

    const from = fromRef.current;
    const start = performance.now();
    const decimals = Number.isInteger(target) ? 0 : 1;

    const tick = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (target - from) * eased;
      setValue(decimals ? Number(next.toFixed(1)) : Math.round(next));
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [target, durationMs]);

  return value;
}
