'use client';

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Keep a scroll container pinned to the bottom while the user hasn't
 * actively scrolled away. Detects "is at bottom" with a 40 px threshold;
 * if the user scrolls up, the auto-stick disengages until they return
 * to the bottom.
 */
export function useStickyBottom(
  ref: RefObject<HTMLElement | null>,
  deps: unknown[] = [],
): void {
  const stickRef = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickRef.current = distance < 40;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [ref]);

  // Synchronously after each render, scroll to bottom if we should stick.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
