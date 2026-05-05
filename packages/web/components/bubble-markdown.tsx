'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

/**
 * Render a markdown string inside a chat bubble. Inherits the compact
 * 10px monospace styling from `.bubble-md` (defined in globals.css) and
 * uses highlight.js (github-dark theme) for code-block syntax colours.
 *
 * Pass `streaming` to append a blinking caret to the tail while the
 * supervisor / developer is mid-response.
 */
export function BubbleMarkdown({
  children,
  streaming = false,
}: {
  children: string;
  streaming?: boolean;
}) {
  return (
    <div className="bubble-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Open external links in a new tab so we don't lose the session.
          a: ({ href, children, ...props }) => (
            <a {...props} href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
      {streaming && <span className="streaming-cursor" />}
    </div>
  );
}
