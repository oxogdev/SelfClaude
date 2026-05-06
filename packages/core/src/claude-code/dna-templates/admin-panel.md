# Admin Panel UI Agent — DNA & Topology

> You build admin panels. This document is the contract: shape, topology, behavior, and standards. Implementation is yours. Deviations require explicit user approval.

---

## 0. Mission

Every admin panel ships with the same shape: same shell, same navigation language, same modal/table/form discipline, same tokens, same state coverage. A new page must be indistinguishable in pattern from every other page. You apply the standard — you don't invent.

**Golden rule**: when two valid approaches exist, this document picks one. Never offer alternatives.

---

## 1. Stack (locked, no substitutes)

| Layer | Choice |
|---|---|
| Framework | Next.js 15+ App Router |
| Language | TypeScript strict |
| Styling | Tailwind CSS v4 (CSS-first `@theme`, no config file) |
| Primitives | shadcn/ui (Radix-based) |
| Forms | react-hook-form + zod + `@hookform/resolvers` |
| Server state | @tanstack/react-query v5 |
| URL state | nuqs |
| Tables | @tanstack/react-table v8 |
| Icons | lucide-react |
| Toasts | sonner |
| Theme | manual (boot script + tiny hooks) |
| Dates | date-fns |
| Path aliases | `@/*` → `src/*` (tsconfig `paths`) |

**Not in stack**: axios, swr, zustand for server state, headlessui, jotai/recoil, next-themes, classnames (use `cn` from `lib/utils`), framer-motion, moment.

---

## 2. Topology

```
src/
├── app/
│   ├── (auth)/login/page.tsx
│   ├── dashboard/
│   │   ├── layout.tsx                # shell ('use client')
│   │   ├── loading.tsx
│   │   ├── error.tsx
│   │   ├── page.tsx                  # home
│   │   ├── settings/page.tsx
│   │   └── [feature]/
│   │       ├── page.tsx              # list (typically client)
│   │       ├── loading.tsx
│   │       ├── error.tsx
│   │       └── [id]/page.tsx         # detail (often server)
│   ├── api/[entity]/route.ts
│   ├── error.tsx                     # root error
│   ├── not-found.tsx                 # root 404
│   ├── globals.css                   # @theme tokens
│   └── layout.tsx                    # root: <html>, boot script, <Providers>
├── components/
│   ├── ui/                           # shadcn primitives + project wrappers (catalog §19)
│   ├── layout/
│   │   ├── sidebar.tsx
│   │   ├── header.tsx
│   │   ├── providers.tsx
│   │   └── nav-config.ts
│   └── [feature]/                    # feature-scoped UI
├── hooks/                            # use-session, use-can, use-theme-mode, use-theme-scheme, use-table-state
├── lib/
│   ├── utils.ts                      # cn() etc.
│   ├── api/client.ts                 # single api module
│   ├── queries/[entity].ts           # query/mutation factories
│   └── validation/                   # shared zod schemas
├── services/[entity].service.ts      # server-side business logic
├── types/                            # types + barrel index.ts
└── config/
    ├── theme.ts                      # mode default + schemes
    └── ui.ts                         # icon size, table defaults
```

**Promotion rule**: feature-scoped UI lives in `components/[feature]/`. Reused twice → promote to `components/ui/`.

**Single source of truth per concern**: nav config, theme config, ui config, api client — exactly one file each.

---

## 3. Visual Contract — Tokens

All visual values are CSS variables in `app/globals.css`. Components reference Tailwind tokens, never hex literals.

### 3.1 Color tokens (semantic, not literal)

Names are stable; values change between modes and schemes.

| Surface | Text | Brand & status |
|---|---|---|
| `bg` page | `fg` primary | `primary` / `primary-fg` |
| `surface` cards/tables/modals | `fg-muted` secondary | `success` / `warning` / `danger` / `info` |
| `surface-hover` row hover | `fg-subtle` labels | |
| `border` / `border-strong` | `fg-dim` placeholder | |

Modes: `.dark` (default) and `.light` redefine the same names. `--primary` and `--primary-fg` are runtime-mutated by the scheme picker.

### 3.2 Radius scale

`--radius-sm` `--radius-md` `--radius-lg` `--radius-xl` (0.375 / 0.5 / 0.75 / 1 rem). Mapping:

| Element | Radius |
|---|---|
| Card / table / modal | `xl` |
| Button / input | `lg` |
| Compact pill / badge | `md` |
| Tag / sort handle | `sm` |

### 3.3 Typography (custom tiers + Tailwind defaults)

Custom tiers defined as Tailwind v4 size+line-height pairs:

| Token | px / lh | Use |
|---|---|---|
| `text-caption` | 11/16 | Table headers, field labels |
| `text-body-xs` | 12/16 | Inputs, code, secondary, badges |
| `text-body` | 13/20 | Table body cells |
| `text-title` | 15/22 | Modal titles |

Tailwind defaults (`text-sm` 14, `text-base` 16, `text-lg` 18, `text-xl` 20) used as documented. Numerics: add `tabular-nums`.

Font: Geist Sans (UI) + Geist Mono (code), via `next/font` in root layout, exposed as `--font-sans` / `--font-mono`. Body: `antialiased`.

### 3.4 Spacing & sizing

| Element | Value |
|---|---|
| Button height | `h-7` sm, `h-8` default, `h-9` lg |
| Form input height | `h-9` |
| Filter bar input height | `h-8` |
| Cell padding | `px-4 py-3` |
| Modal header / body | `px-5 py-4` |
| Modal footer | `px-5 py-3` |
| Page padding | `p-4 md:p-6` |
| Section gap | `space-y-4` |
| Stats grid gap | `gap-3` |
| Filter bar gap | `gap-2` |
| Touch target min | `32×32` |

Reuse these — don't invent new values.

---

## 4. Layout Shell

```
┌──────────────────┬───────────────────────────┐
│ Sidebar Header   │ Header 52px (sticky)      │  ← same height,
│ 52px (logo)      │                           │     aligned top
├──────────────────┼───────────────────────────│
│                  │  PageHeader               │
│ Sidebar Nav      │                           │
│ (scroll)         │  Content                  │
│                  │  (max-w-[1400px])         │
│                  │                           │
├──────────────────┤                           │
│ Sidebar Footer   │                           │
│ (user chip)      │                           │
└──────────────────┴───────────────────────────┘
```

### 4.1 Root

- `h-svh` flex row, `overflow-hidden` on `html, body`
- `app/dashboard/layout.tsx` is `"use client"` (drawer + collapse state)

### 4.2 Sidebar (3-zone anatomy)

The sidebar is itself a flex column with three zones — header, nav, footer — each with its own role.

| Zone | Height | Contents | Behavior |
|---|---|---|---|
| **Sidebar header** | `h-[52px]` (matches main Header — top edges align) | Logo (left). On mobile only: close button (right). | `shrink-0`, bottom border `border-border` |
| **Sidebar nav** | `flex-1` | Nav groups + items (§6) | `overflow-y-auto overscroll-contain` |
| **Sidebar footer** | `shrink-0` | User chip: `<Avatar size="sm">` (initials fallback) + role label + truncated userId | Top border `border-border`, padding `p-3` |

**Width**: 250px on desktop. Collapses to 0 (`md:w-0 md:overflow-hidden md:border-0`) when toggled — content area expands. Collapse state persisted to `localStorage["ui-sidebar"]`.

**Nav visual anatomy** (within the nav zone):

| Element | Style |
|---|---|
| Group title | `px-4 mb-2 text-caption text-fg-subtle tracking-wide` |
| Group spacing | `gap-6` between groups |
| Item container | `px-2 gap-0.5` |
| Item | `flex items-center gap-3 rounded-lg px-3 py-[9px] text-sm` |
| Item icon | size 18, `opacity-80` |
| Item — inactive | `text-fg-muted hover:bg-surface-hover hover:text-fg` |
| Item — active | `bg-surface-hover text-fg font-medium` |

**Toggle behavior**: a single button in main Header. On `< md` it opens/closes the offcanvas drawer (§4.3); on `≥ md` it collapses/expands the persistent sidebar. A resize across the breakpoint resets the inactive mode to its default — drawer auto-closes when shrinking; collapse state preserved when growing.

### 4.3 Mobile behavior (< md / 768px)

The sidebar becomes a **full-bleed offcanvas drawer**, identical 3-zone anatomy.

| Aspect | Rule |
|---|---|
| Position | `fixed inset-y-0 left-0 z-50`, `w-full` (full viewport width) |
| Default | Closed: `-translate-x-full` |
| Open | `translate-x-0` with `transition-transform duration-300 ease-in-out` |
| Backdrop | `fixed inset-0 z-40 bg-black/70 backdrop-blur-[2px]`, fades in/out |
| Open trigger | Menu button in main Header |
| Close triggers | Close button in sidebar header / backdrop click / Esc / **tapping any nav item** (auto-close after navigation) |
| Body scroll | Locked while drawer open (`document.body.style.overflow = "hidden"`) |

On `≥ md` the sidebar reverts to a static flex column, and the drawer mechanics (translate, backdrop, body lock) are inactive.

### 4.4 Main Header (52px, sticky)

Sticky `top-0`, `h-[52px]`, `border-b border-border`, `bg-bg`. Aligned top edge with sidebar header — both 52px ensures a single horizontal line across the top.

| Region | Contents |
|---|---|
| Left | Sidebar toggle button (collapses on desktop, opens drawer on mobile) + mobile logo (visible only `< md` when drawer is closed) |
| Center | Optional breadcrumb (rare; usually empty — breadcrumb belongs in `<PageHeader>`) |
| Right | `<ThemeToggle />` + divider + user menu (avatar + dropdown: profile / settings / logout) |

### 4.5 Content area

- `<main>` with internal `overflow-y-auto overscroll-contain`
- Padding `p-4 md:p-6`
- `max-w-[1400px]` — content centers within viewport on ultra-wide screens
- `<PageHeader>` (§7) renders first inside `<main>`

### 4.6 LocalStorage keys (single reference)

| Key | Type | Purpose | Section |
|---|---|---|---|
| `ui-mode` | `"dark" \| "light"` | Theme mode | §14.1 |
| `ui-scheme` | scheme name | Accent color scheme | §14.2 |
| `ui-sidebar` | `"open" \| "collapsed"` | Desktop sidebar state | §4.2 |

All keys are namespaced `ui-*`. New persistence needs follow the same prefix.

---

## 5. Routing Topology

### 5.1 Server vs Client components

- App Router default = **Server**. Add `"use client"` only for files using hooks or DOM events.
- List pages with URL state, mutations, interactive filters → `"use client"`.
- Static / pre-rendered detail pages → Server; may `await api.get(...)` directly.
- Layouts with stateful UI → `"use client"`.
- Hybrid (Server prefetch → Client consume): use react-query `prefetchQuery` + `<HydrationBoundary state={dehydrate(qc)}>`.
- Server fetches: Next.js 15 defaults `fetch` to `no-store`. For caching/revalidation, use `next: { revalidate }` or `unstable_cache`.

### 5.2 Route boundaries (mandatory per route)

| File | Purpose | Renders |
|---|---|---|
| `loading.tsx` | Suspense fallback | `<TableSkeleton />` (lists) or `<LoadingState />` (detail) |
| `error.tsx` | error boundary (`"use client"`) | `<ErrorState>` with `reset` action |
| `not-found.tsx` | 404 | `<EmptyState icon={SearchX} title="Not found" />` + back link |

Root `app/error.tsx` and `app/not-found.tsx` are mandatory.

### 5.3 Metadata

Every dashboard route exports metadata. Title format: `"{Page} | {AppName}"` where `AppName` is exported from `config/app.ts` (`export const APP_NAME = "..."`). Detail pages use `generateMetadata` to fetch the entity name.

---

## 6. Navigation & RBAC

### 6.1 Single nav config

`components/layout/nav-config.ts` is the single source of truth for the sidebar. Server endpoints **always** re-validate; client filtering is cosmetic.

### 6.2 Gating model

- **Roles** (`Role[]`): any-of (OR). E.g. group visible if user matches any listed role.
- **Permissions** (`Permission[]`): all-of (AND). E.g. item visible only if user holds every listed permission.
- **Combination**: item passes if `roles` AND `permissions` both pass.
- **Empty-group rule**: a group with zero visible items auto-hides (no empty headers).
- **Provider**: `useCan()` exposes `role(rs?)`, `permission(ps?)`, `any(rs?, ps?)` — all return `boolean`. Used for buttons, table actions, settings sections — anywhere role-aware UI appears.
- **Hidden vs disabled**: hide what the user can't do at all; disable (with tooltip) what they could do but is blocked by record state.
- **No-access screen**: render `<NoAccessState />` instead of redirecting from inside content.

### 6.3 Nav config shape

```ts
type Role = "super" | "admin" | "viewer" | string;
type Permission = string;                    // "users.read", "settings.write", ...

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles?: Role[];
  permissions?: Permission[];
}
interface NavGroup {
  title: string;
  roles?: Role[];
  items: NavItem[];
}
```

---

## 7. PageHeader (mandatory unless `hide`)

Below `<Header>`, above content. Bottom border `border-border`, `pb-4 mb-4`.

| Prop | Type | Notes |
|---|---|---|
| `title` | `string` | h1 |
| `description` | `string?` | one-line muted subtitle |
| `icon` | `LucideIcon?` | left of title, size 20 |
| `noIcon` | `boolean?` | suppress icon even if provided |
| `hide` | `boolean?` | render nothing |
| `breadcrumb` | `{label,href?}[]?` | items |
| `actions` | `ReactNode?` | right-aligned; wraps below title on `< sm` |

---

## 8. Modal Discipline

### 8.1 `<AppModal>` (the standard modal)

**Sizes (locked)**: `sm` 384px / `md` 512px (default) / `lg` 768px / `full` 95vw·95vh.

**Anatomy**: sticky header (title + close) → scrollable body → sticky footer.

**Rules**:
- Built on shadcn `<Dialog>` internally — never import `<Dialog>` directly
- If body has form/inputs → footer with action buttons is **mandatory**
- Cancel always left of primary
- Mobile: full-bleed minus `inset-x-4`
- Backdrop: `bg-black/70 backdrop-blur-[2px]`
- `locked={true}` (during async work): overlay click no-op, Esc no-op, close button hidden
- Esc closes (unless `locked`); focus trap on; restore focus on close

### 8.2 `<ConfirmDialog>`

For all confirmations (alert / yes-no). Built on shadcn `<AlertDialog>`. **No inputs** allowed. Variants: `default`, `destructive`. `loading` prop reflects async confirm.

### 8.3 `<TypedConfirmDialog>`

Irreversible destructive flows ("type the name to confirm"). Built on `<AppModal size="sm">` with one validated text field that must match `confirmation` prop exactly before the confirm button enables.

### 8.4 `<Drawer>`

Slide-in panel (right or left), used as a mobile-friendly alternative to `AppModal lg/full` for long edit flows. Same anatomy as AppModal (sticky header + scrollable body + sticky footer + `locked`). Sizes: `sm` 320 / `md` 420 / `lg` 560.

**Distinct from the mobile sidebar drawer in §4.3**: that one is the offcanvas navigation; `<Drawer>` here is a content-edit primitive available on every viewport.

### 8.5 Discipline

| Need | Use |
|---|---|
| Edit / create with form | `<AppModal>` |
| Yes-no, alert | `<ConfirmDialog>` |
| Type-to-confirm destructive | `<TypedConfirmDialog>` |
| Long edit on mobile / inspector | `<Drawer>` |

`window.alert` / `confirm` / `prompt` are forbidden.

---

## 9. Form Discipline

### 9.1 Stack & shape

`react-hook-form` for state, `zod` for schema, `@tanstack/react-query` `useMutation` for submit. Each form is one component; the modal/page hosts the footer buttons (which target the form via `form={id}`).

### 9.2 `<FormField>` anatomy

Label (`text-caption text-fg-subtle`, optional red dot if `required`) → control → error (`text-body-xs text-danger` from RHF formState) → hint (`text-body-xs text-fg-subtle`).

Controls receive `aria-invalid` + `aria-describedby` automatically when `error` is present.

### 9.3 Async submit lock matrix

While `mutation.isPending`:

| Element | State |
|---|---|
| Submit button | spinner + disabled (via `loading` prop) |
| Cancel button | disabled |
| All inputs | disabled (`<fieldset disabled>`) |
| Hosting modal/drawer | `locked` |
| Navigation | blocked |

### 9.4 Optimistic updates

Use react-query `onMutate` + `setQueryData` + `onError` rollback + `onSettled` invalidate. Apply only when:

- Action is **idempotent and reversible** in the UI (toggle, reorder, edit text)
- Failure can roll back cleanly with a toast

**Never optimistic** for: deletes, publishes-of-record, payments, anything triggering external side effects.

### 9.5 File uploads (`<ImageUpload>`)

- Drag & drop + click + URL paste (in upload modal)
- Use **XHR with progress events** (fetch has no progress API)
- Validate type + size client-side **before** upload; toast on reject
- Show progress 0→100%, byte counter, cancel button
- Preview before upload completes

---

## 10. Table Discipline

### 10.1 Mandatory features (every list page)

- `<DataTable>` built on `@tanstack/react-table v8`
- Sortable columns (asc/desc toggle on click)
- Filterable via `<FilterBar>`
- **Server-side** pagination (`page` + `perPage`)
- All state in URL via `nuqs` — refresh-safe, shareable, history-safe
- Sticky header inside the scroll container
- Horizontal scroll on overflow with table `min-width`
- Loading / empty / error via shared state components (§11)

### 10.2 URL state contract

URL holds: `page`, `perPage`, `sort`, `dir` (`asc`|`desc`), `q`. Any extra filters live in the same URL state under typed parsers.

`useTableState()` returns `[state, setState]` from `nuqs.useQueryStates` with typed parsers and defaults.

### 10.3 react-query key rule

`queryKey` MUST use **primitive spread**, never the state object directly:

```
queryKey: [entity, s.page, s.perPage, s.sort, s.dir, s.q]
```

A `listKey(entity, state)` helper in `hooks/use-table-state.ts` enforces this. Object references break cache hashing in subtle ways and cause refetch loops.

### 10.4 Pagination footer

`«« ‹ 1 2 3 … N › »»` + per-page selector (`10/15/30/50`) + "Page N of M". Active page: `bg-primary text-primary-fg`. Buttons `w-8 h-8`. Footer is part of `<DataTable>`, not the page.

### 10.5 Row actions

| Count | UI |
|---|---|
| 1–2 | Inline buttons at row end |
| 3+ | `<MoreHorizontal />` opens `<DropdownMenu>` |

Destructive items: `text-danger` + `<Trash2 />`, last in menu.

---

## 11. State Coverage (mandatory)

Every async boundary handles **all three**: loading, empty, error. No inline `Loading...` text. No bare `null`. No blank screen during fetch.

### 11.1 Component map

| Component | Use |
|---|---|
| `<LoadingState>` | generic centered spinner block |
| `<TableSkeleton>` | list pages while loading |
| `<CardSkeleton>` | stats grids while loading |
| `<Spinner>` | inline (in buttons, tight spaces) |
| `<EmptyState>` | zero results / first-run |
| `<ErrorState>` | failed fetch / boundary error |
| `<NoAccessState>` | RBAC denial inside content |

### 11.2 Async feedback matrix

| Operation | Feedback |
|---|---|
| Page-level fetch | Skeleton (table or cards), never blank |
| Inline async (button) | Spinner inside button + disabled |
| Form submit | Submit lock matrix (§9.3) |
| File upload | Progress bar (XHR) + cancel |
| Long fetch (>500ms) | Skeleton; under 500ms keep prior state |
| Background mutation | Optimistic UI + toast on settle |
| Destructive | ConfirmDialog → spinner → toast |
| Background job trigger | Toast "Started" + status polling/badge |

The user must never wonder "is it doing something?"

---

## 12. Notifications

- One `<Toaster />` mounted in `<Providers>` — `position="bottom-right"`, `richColors`, `closeButton`
- Variants: `success`, `error`, `info`, `warning`, `loading` (resolved by `id`)
- Duration: 4s default, errors 6s, loading until resolved
- Toast must **never** be the sole signal of a form-field error — pair with inline error text

---

## 13. Iconography

- **lucide-react only**. Inline SVG forbidden everywhere.
- Default `strokeWidth`: `1.5`
- Default size by context:

| Context | Size |
|---|---|
| Inside `<Button>` (auto via shadcn `[&_svg]:size-4`) | 16 |
| Default body | 18 |
| Page header | 20 |
| Empty-state hero | 40 (stroke `1.25`) |

Centralized in `config/ui.ts`. Don't override Button's icon size.

---

## 14. Theme System

### 14.1 Mode

- Default: **dark**
- Toggle: dark ↔ light only (**no system mode**)
- Class strategy: `<html class="dark">` or `<html class="light">`
- Storage: `localStorage["ui-mode"]`

### 14.2 Scheme

- Single config file `config/theme.ts` defines `defaultMode`, `defaultScheme`, and a `schemes` map (`name → { primary, primaryFg }`)
- Scheme picker mutates `--primary` and `--primary-fg` at runtime on `<html>`
- Storage: `localStorage["ui-scheme"]`
- Switching is **instant + persisted**; no Save button
- Projects extend the schemes map without changing the picker

### 14.3 Boot script (FOUC prevention — mandatory)

A module-level inline `<script>` in root `<head>` runs **before** any CSS or React:

1. Reads `ui-mode` from localStorage (fallback to `defaultMode`)
2. Adds the corresponding class to `<html>`
3. Reads `ui-scheme` (fallback to `defaultScheme`)
4. Sets `--primary` and `--primary-fg` from the schemes map
5. Wrapped in try/catch; never throws

`<html suppressHydrationWarning>` is mandatory because the boot script mutates DOM before hydration.

### 14.4 Hooks

- `useThemeMode()` → `{ mode, setMode, toggle }`. Initial `mode` synced from DOM in `useEffect`.
- `useThemeScheme()` → `{ scheme, setScheme, schemes }`. Initial `scheme` synced from `localStorage` in `useEffect`.

Both are SSR-safe: state initializes to a default; effect reconciles from the source of truth.

### 14.5 Provider tree (root `<body>`)

```
<NuqsAdapter>
  <QueryClientProvider client={...}>
    {children}
    <Toaster />
  </QueryClientProvider>
</NuqsAdapter>
```

Inside `<Providers>` (the `"use client"` component that hosts this tree), an effect registers a `window`-level `"auth:expired"` listener that calls `router.push("/login")` (§15.3). Theme is class-on-`<html>` — no provider needed.

---

## 15. Data Layer

### 15.1 API client (single module)

`lib/api/client.ts` exports:

- `api.get<T>(url)` / `api.post<T,B>(url,body)` / `api.put` / `api.patch` / `api.delete<T>(url)`
- `ApiError extends Error` with `status: number`
- All non-2xx responses throw `ApiError`
- On `401`: dispatches `window.dispatchEvent(new CustomEvent("auth:expired"))` then throws
- Body is JSON-serialized; `Content-Type: application/json` set automatically
- No retry (react-query handles retry policy)

Components and hooks **never** call `fetch` directly in Client Components. Server Components may use `api.get`.

### 15.2 react-query defaults

In `<Providers>`, `QueryClient` is created via `useState(() => new QueryClient(...))` (one per browser tab; never module-level).

Defaults:

| Option | Value |
|---|---|
| `queries.staleTime` | 30 000 |
| `queries.gcTime` | 300 000 |
| `queries.retry` | 1 |
| `queries.refetchOnWindowFocus` | `false` |
| `mutations.retry` | 0 |

### 15.3 Auth-expired listener

Inside `<Providers>`, an effect adds a `window`-level `"auth:expired"` listener that calls `router.push("/login")`. Single listener mounted once.

### 15.4 Query/mutation factories

Convention: one file per entity in `lib/queries/[entity].ts`. Named exports:

- `useXxxList(state)` — returns `useQuery` configured with `listKey` + `listQs`
- `useCreateXxx()` / `useUpdateXxx()` / `useDeleteXxx()` — return `useMutation` with toast on success/error and `invalidateQueries({ queryKey: [entity] })` on success
- `useXxx(id)` — single-item query

Every list query passes `placeholderData: (prev) => prev` for smooth pagination.

---

## 16. Settings Template

### 16.1 Layout

Two-pane: 220px section nav + content. Mobile: `<Select>` at top of content. Active section in URL: `?section=appearance` (typed enum via `nuqs`). Each section gated via `useCan()`.

### 16.2 Canonical sections (present-only, ordered)

| Slug | Content | Gate |
|---|---|---|
| `general` | App name, locale, timezone, default landing | `settings.read` |
| `appearance` | Mode toggle + scheme picker (§14) | always |
| `profile` | Avatar, display name, email | always |
| `security` | Password, 2FA, active sessions | always |
| `notifications` | Email/push toggles | always |
| `members` | Team list + invite + role assignment | role:`super` |
| `integrations` | API keys, webhooks | `settings.write` |
| `danger` | Destructive actions | role:`super` |

### 16.3 Section card pattern

`<SettingsSection title description variant?="default|danger">`. One form per card; multiple cards per section is fine. Footer (`<SettingsFooter dirty>`) shows Discard + Save; Discard appears only when `formState.isDirty`. Toggles use optimistic updates (§9.4); fields use submit-lock matrix (§9.3).

### 16.4 Profile & Danger specifics

- **Profile**: `<Avatar size="lg">` + `<ImageUpload>` (96×96 preview); fallback = initials. Email/password change re-auths via `<AppModal size="sm">` with single password field. Sessions in a `<DataTable>` with per-row "Revoke" + top "Revoke all others".
- **Danger zone**: `variant="danger"` (red border + accent). Reversible action → `<ConfirmDialog variant="destructive">`. Irreversible action → `<TypedConfirmDialog>`.

---

## 17. Accessibility (mandatory)

- Visible focus ring on every interactive: `focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg`
- shadcn primitives include focus rings — extend, don't replace
- `aria-label` on icon-only buttons; `title` for tooltip
- Tab order matches visual order; Esc closes overlays; Enter submits forms; arrows in menus/comboboxes
- Tables: `<th scope="col">`; sortable headers as `<button>` with `aria-sort`
- Modals: focus trap + restore focus + `aria-labelledby` on title (shadcn handles)
- Forms: `<label htmlFor>`, `aria-invalid`, `aria-describedby` for errors/hints
- Color is never the sole signal — pair with icon or text
- Min target size 32×32; icon-only buttons `h-8 w-8` minimum

---

## 18. Responsiveness

- Mobile-first. Test at 360 / 768 / 1024 / 1440.
- Sidebar mobile/desktop behavior: see §4.3 (offcanvas) and §4.2 (collapse).
- Stats grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`.
- Filter bar: `flex-wrap`, full-width inputs on mobile.
- Tables: `overflow-x-auto`, `min-width` per table.
- Modals: full-bleed minus `inset-x-4` on mobile.
- PageHeader actions: wrap below title on `< sm`.

---

## 19. Component Catalog (props contracts)

The contract for every shared UI component. Props not listed are not allowed. If you need a primitive not listed, ask before inventing.

**Note on layout components**: `<Sidebar>` and `<Header>` are single-instance shells in `components/layout/`. They have no public props — their content is driven by `nav-config.ts` (§6) and the active session. They are not part of this catalog.

```ts
// Layout
interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  noIcon?: boolean;
  hide?: boolean;
  breadcrumb?: { label: string; href?: string }[];
  actions?: ReactNode;
}

// Stats
interface StatsWidgetProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  trend?: { value: string; positive?: boolean };
  loading?: boolean;
  compact?: boolean;
}

// Modal family
interface AppModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: "sm" | "md" | "lg" | "full";       // default "md"
  locked?: boolean;
  children: ReactNode;
  footer?: ReactNode;                        // mandatory if body has inputs
}
interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  variant?: "default" | "destructive";
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}
interface TypedConfirmDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  confirmation: string;                       // exact text user must type
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";        // default "destructive"
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}
interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: "right" | "left";                    // default "right"
  size?: "sm" | "md" | "lg";                  // 320 / 420 / 560
  title: string;
  description?: string;
  locked?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}

// Table
interface DataTableState {
  isLoading: boolean;
  error?: Error | null;
  total: number;
  page: number;
  perPage: number;
  sort: string;
  dir: "asc" | "desc";
  q?: string;
}
interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  state: DataTableState;
  onChange: (s: Partial<DataTableState>) => void;
  rowActions?: (row: T) => ReactNode;
  emptyState?: ReactNode;
  errorState?: ReactNode;
  perPageOptions?: number[];                  // default [10,15,30,50]
}
interface FilterBarProps { children: ReactNode }

// State components
interface EmptyStateProps    { icon?: LucideIcon; title: string; description?: string; action?: ReactNode }
interface ErrorStateProps    { title?: string; description?: string; action?: ReactNode }
interface LoadingStateProps  { label?: string }
interface TableSkeletonProps { rows?: number; cols?: number }
interface CardSkeletonProps  { count?: number }
interface NoAccessStateProps { title?: string; description?: string }
interface SpinnerProps       { size?: "xs" | "sm" | "md" | "lg"; className?: string }

// Profile bits
interface AvatarProps {
  src?: string;
  alt: string;
  fallback: string;                           // initials, e.g. "AB"
  size?: "sm" | "md" | "lg";                  // 24 / 32 / 40
}

// Form & inputs
interface FormFieldProps {
  name: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;                             // pass from RHF formState
  children: ReactNode;
}
interface ComboboxOption { value: string; label: string }
interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  clearable?: boolean;
  disabled?: boolean;
}
interface DatePickerProps {
  value?: Date;
  onChange: (d: Date | undefined) => void;
  placeholder?: string;
  min?: Date;
  max?: Date;
  disabled?: boolean;
}
interface ImageUploadProps {
  value?: string;
  onChange: (url: string) => void;
  uploadUrl: string;
  folder?: string;
  maxSizeMB?: number;                         // default 5
  accept?: string;                            // default "image/*"
  preview?: "thumb" | "square";               // default "thumb"
}

// Settings
interface SettingsSectionProps {
  title: string;
  description?: string;
  variant?: "default" | "danger";
  children: ReactNode;
}
interface SettingsFooterProps {
  dirty?: boolean;                            // hides if undirty
  children: ReactNode;
}

// Theme
interface ThemeToggleProps { size?: "sm" | "md" }
// SchemePicker takes no props

// Button (extends shadcn)
interface ButtonProps extends React.ComponentProps<"button"> {
  variant?: "default" | "secondary" | "ghost" | "outline" | "destructive" | "link";
  size?: "sm" | "default" | "lg" | "icon";
  loading?: boolean;                          // spinner + disabled
  asChild?: boolean;
}
```

---

## 20. Authoring Checklist

- [ ] Folder location matches §2; reused twice → promoted to `components/ui/`
- [ ] Page wrapped in `<PageHeader>` (or explicit `hide`)
- [ ] Zero hex literals in JSX; all colors via tokens (§3)
- [ ] Zero inline SVG; all icons from lucide-react (§13)
- [ ] List state via `useTableState` (nuqs); `queryKey` uses primitive spread (§10.3)
- [ ] Loading + empty + error all handled with shared components (§11)
- [ ] Forms: RHF + zod + `useMutation`; submit-lock matrix applied; inline + toast errors
- [ ] Confirms: `<ConfirmDialog>` / `<TypedConfirmDialog>`; never `window.confirm`
- [ ] Modals: explicit size; `locked` during mutations; footer mandatory if inputs present
- [ ] Toast on every async settle (success + error)
- [ ] `aria-label` on icon buttons; focus rings visible; Esc closes overlays
- [ ] Mobile tested at 360px (drawer, wrap, scroll)
- [ ] Dark + light both verified; scheme switch instant
- [ ] RBAC: `useCan()` gates UI; server still re-validates
- [ ] Route has `loading.tsx`, `error.tsx`; metadata exported
- [ ] `'use client'` only where required; Server Components for static/RSC paths
- [ ] No `console.log`, no commented code, no TODO without owner

---

## 21. Forbidden (hard NO)

- `window.alert` / `window.confirm` / `window.prompt`
- Inline SVG outside `lucide-react`
- Hex literals in JSX (use tokens)
- `fetch` inside Client Components — go through `api.*` + react-query
- Any data-fetching library other than react-query
- Form state with raw `useState` (use RHF + zod)
- List filters in local state only — must be `nuqs` URL params
- "Loading..." text instead of skeleton
- Blank screen during fetch
- Toast as the only error signal on a form field
- `as any`, `// @ts-ignore` without an explanatory comment
- Adding any library outside §1 without explicit user approval
- `<Dialog>` / `<AlertDialog>` imported directly — go through `<AppModal>` / `<ConfirmDialog>`
- Inventing a primitive not in §19 — ask first
- Module-level `new QueryClient()` — must be `useState(() => new QueryClient())` inside `<Providers>`
- Object-reference react-query `queryKey` — must be primitive spread (§10.3)

---

**End of DNA.** This document supersedes any conflicting instruction except direct user override.
