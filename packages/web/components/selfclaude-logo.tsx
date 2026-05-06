'use client';

import { cn } from '@/lib/cn';

/**
 * SelfClaude wordmark + mark. Two variants, two sizes:
 *
 *   - `wordmark` — full identifier, used on the landing screen + page
 *     headers. Vertical cyan accent bar followed by mixed-weight
 *     "selfClaude": "self" in cyan medium, "Claude" in zinc bold. The
 *     dual-weight + accent gives it presence without becoming
 *     decorative — the goal is "premium, sober", not playful.
 *
 *   - `mark` — square monogram. Lower-cased "sc" inside a thin cyan
 *     rounded box. Designed to slot into the 14×14 home-icon spot in
 *     the tab bar without needing a separate raster asset.
 *
 * Sizes scale via `em` rather than fixed pixels so the component picks
 * up the parent's text-size — a `text-2xl` parent makes the logo feel
 * heroic, a `text-xs` parent shrinks it gracefully.
 */
type LogoVariant = 'wordmark' | 'mark';
type LogoSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_TEXT: Record<LogoSize, string> = {
  xs: 'text-[10px]',
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-2xl',
  xl: 'text-4xl',
};

export function SelfClaudeLogo({
  variant = 'wordmark',
  size = 'md',
  className,
  caption,
}: {
  variant?: LogoVariant;
  size?: LogoSize;
  /** Optional override / extension classes. Useful for letter-spacing or color tweaks. */
  className?: string;
  /** Small subdued line below the wordmark (e.g. version, tagline). */
  caption?: string;
}) {
  if (variant === 'mark') {
    return (
      <span
        className={cn(
          'inline-flex items-center justify-center font-mono font-bold rounded',
          'bg-cyan-950/40 border border-cyan-700/50 text-cyan-300 tracking-tight',
          SIZE_TEXT[size],
          className,
        )}
        style={{ width: '1.6em', height: '1.6em' }}
        aria-label="SelfClaude"
      >
        sc
      </span>
    );
  }
  // wordmark
  return (
    <span className={cn('inline-flex flex-col gap-0.5', className)}>
      <span className={cn('inline-flex items-baseline gap-2 font-mono', SIZE_TEXT[size])}>
        <span
          className="inline-block bg-cyan-500 rounded-sm shrink-0"
          style={{ width: '0.2em', height: '1em' }}
          aria-hidden
        />
        <span className="tracking-tight leading-none">
          <span className="text-cyan-300 font-medium">self</span>
          <span className="text-zinc-100 font-bold">Claude</span>
        </span>
      </span>
      {caption && (
        <span
          className="ml-[calc(0.2em+0.5rem)] text-[0.55em] uppercase tracking-[0.2em] font-mono text-zinc-500"
          aria-hidden
        >
          {caption}
        </span>
      )}
    </span>
  );
}
