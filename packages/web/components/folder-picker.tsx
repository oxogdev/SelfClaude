'use client';

import { useEffect, useState } from 'react';
import { Folder, FolderOpen, ChevronUp, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { BrowseResult } from '@/lib/types';
import { cn } from '@/lib/cn';

export function FolderPicker({
  onSelect,
  onCancel,
}: {
  onSelect: (path: string) => void;
  onCancel: () => void;
}) {
  const [data, setData] = useState<BrowseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const browse = async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.browse(path);
      setData(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void browse();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-bg-panel w-[640px] max-h-[70vh] flex flex-col rounded-lg border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-medium">Open project folder</h2>
          <button
            onClick={onCancel}
            className="text-zinc-400 hover:text-zinc-200"
            aria-label="close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg-subtle">
          <button
            onClick={() => data?.parent && browse(data.parent)}
            disabled={!data?.parent}
            className="text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
            aria-label="go up"
          >
            <ChevronUp size={16} />
          </button>
          <code className="text-sm text-zinc-300 truncate flex-1">{data?.path ?? '…'}</code>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {loading && <div className="p-6 text-sm text-zinc-400">Loading…</div>}
          {error && <div className="p-6 text-sm text-red-400">{error}</div>}
          {!loading &&
            !error &&
            data &&
            data.entries
              .filter((e) => e.isDir && !e.isHidden)
              .map((entry) => (
                <button
                  key={entry.name}
                  onDoubleClick={() => browse(joinPath(data.path, entry.name))}
                  onClick={() => browse(joinPath(data.path, entry.name))}
                  className={cn(
                    'flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-bg-elevated',
                    'border-l-2 border-transparent',
                  )}
                >
                  <Folder size={16} className="text-zinc-500" />
                  <span>{entry.name}</span>
                </button>
              ))}
          {!loading &&
            !error &&
            data &&
            data.entries.filter((e) => e.isDir && !e.isHidden).length === 0 && (
              <div className="p-6 text-sm text-zinc-500">(no subfolders)</div>
            )}
        </div>

        <div className="flex items-center justify-between p-4 border-t border-border bg-bg-subtle">
          <code className="text-xs text-zinc-500 truncate flex-1 mr-4">{data?.path}</code>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-sm rounded border border-border hover:bg-bg-elevated"
            >
              Cancel
            </button>
            <button
              onClick={() => data && onSelect(data.path)}
              disabled={!data}
              className="px-3 py-1.5 text-sm rounded bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50 flex items-center gap-1"
            >
              <FolderOpen size={14} />
              Open this folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function joinPath(parent: string, name: string): string {
  return parent === '/' ? `/${name}` : `${parent}/${name}`;
}
