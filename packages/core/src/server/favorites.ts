import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';

const FAVORITES_PATH = join(homedir(), '.selfclaude', 'favorites.json');

export const FavoriteSchema = z.object({
  cwd: z.string(),
  label: z.string(),
  pinnedAt: z.number(),
});

const FavoritesFileSchema = z.object({
  favorites: z.array(FavoriteSchema),
});

export type Favorite = z.infer<typeof FavoriteSchema>;

function loadFile(): { favorites: Favorite[] } {
  if (!existsSync(FAVORITES_PATH)) return { favorites: [] };
  try {
    const raw = readFileSync(FAVORITES_PATH, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const result = FavoritesFileSchema.safeParse(parsed);
    if (result.success) return result.data;
  } catch {
    /* ignore — corrupted file → treat as empty */
  }
  return { favorites: [] };
}

function persistFile(data: { favorites: Favorite[] }): void {
  mkdirSync(dirname(FAVORITES_PATH), { recursive: true });
  writeFileSync(FAVORITES_PATH, `${JSON.stringify(data, null, 2)}\n`);
}

export function listFavorites(): Favorite[] {
  return loadFile().favorites;
}

export function addFavorite(cwd: string, label?: string): Favorite {
  const data = loadFile();
  const existing = data.favorites.find((f) => f.cwd === cwd);
  if (existing) return existing;
  const fav: Favorite = {
    cwd,
    label: label && label.length > 0 ? label : basename(cwd) || cwd,
    pinnedAt: Date.now(),
  };
  data.favorites.push(fav);
  persistFile(data);
  return fav;
}

export function removeFavorite(cwd: string): boolean {
  const data = loadFile();
  const before = data.favorites.length;
  data.favorites = data.favorites.filter((f) => f.cwd !== cwd);
  if (data.favorites.length === before) return false;
  persistFile(data);
  return true;
}
