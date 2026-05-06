'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

export interface StickyBottomOptions {
  /**
   * Fires when the operator scrolls within `nearTopThreshold` px of the
   * top of the container. Used by chat panes to trigger lazy-loading
   * older history.
   */
  onNearTop?: () => void;
  /** Pixel threshold for "near top" (default 80). */
  nearTopThreshold?: number;
}

export interface StickyBottomApi {
  /** True when the scroll position is within 40px of the bottom. */
  isAtBottom: boolean;
  /**
   * Programmatically scroll the container to the bottom, with a smooth
   * animation. Re-engages auto-stick so subsequent appends keep pinning.
   */
  scrollToBottom: () => void;
}

/**
 * Keep a scroll container pinned to the bottom while the user hasn't
 * actively scrolled away. Detects "is at bottom" with a 40 px threshold;
 * if the user scrolls up, the auto-stick disengages until they return
 * to the bottom (or call `scrollToBottom` from the floating button).
 *
 * Returns:
 *   - `isAtBottom` (state) so the caller can render a "scroll to bottom"
 *     button overlay only when relevant.
 *   - `scrollToBottom` (callback) the same overlay can wire to.
 *
 * Optionally fires `onNearTop` for lazy-loading older history.
 */
export function useStickyBottom(
  ref: RefObject<HTMLElement | null>,
  deps: unknown[] = [],
  opts: StickyBottomOptions = {},
): StickyBottomApi {
  const stickRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const onNearTopRef = useRef(opts.onNearTop);
  onNearTopRef.current = opts.onNearTop;
  const threshold = opts.nearTopThreshold ?? 80;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = distance < 40;
      stickRef.current = atBottom;
      setIsAtBottom(atBottom);
      if (el.scrollTop < threshold) {
        onNearTopRef.current?.();
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [ref, threshold]);

  // Synchronously after each render, scroll to bottom if we should stick.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const scrollToBottom = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    stickRef.current = true;
    setIsAtBottom(true);
  }, [ref]);

  return { isAtBottom, scrollToBottom };
}
