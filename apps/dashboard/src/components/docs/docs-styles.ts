/**
 * Shared typography and interaction tokens for /docs and related guides.
 * Sans-first prose; monospace reserved for code and identifiers.
 */

export const docsFocus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 dark:focus-visible:ring-zinc-500/40 dark:focus-visible:ring-offset-zinc-950";

/** Primary section title (manual & guides) */
export const docsSectionTitle =
  "text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100";

/** Subheading inside a section (h3) */
export const docsSubsectionTitle =
  "text-sm font-medium text-zinc-800 dark:text-zinc-200";

/** Sidebar / “On this page” label */
export const docsNavLabel =
  "text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400";

/** Body copy */
export const docsBody =
  "text-sm leading-relaxed text-zinc-600 dark:text-zinc-400";

/** Secondary / note text */
export const docsMuted =
  "text-sm text-zinc-500 dark:text-zinc-400";

/** Inline prose links */
export const docsProseLink = `text-zinc-800 underline-offset-2 transition-colors hover:underline dark:text-zinc-200 ${docsFocus} rounded-sm`;

/** Page masthead (matches docs index) */
export const docsPageTitle =
  "text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50";

export const docsPageSubtitle =
  "mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400";

/** Inline code in prose */
export const docsInlineCode =
  "rounded bg-zinc-100 px-1 py-0.5 font-mono text-[13px] text-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-300";

/** Definition list term (stack names, flags) */
export const docsDlTerm =
  "text-sm font-semibold text-zinc-800 dark:text-zinc-100";

export const docsDlTermMono =
  "font-mono text-[11px] font-normal text-zinc-500 dark:text-zinc-400";

/** Horizontal rule between blocks */
export const docsDivider =
  "border-t border-zinc-200/90 dark:border-zinc-800/90";

/** TOC / in-page anchor links */
export const docsTocLink =
  "text-sm text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100";

/** CLI flags and technical identifiers in definition lists */
export const docsFlagTerm =
  "font-mono text-xs font-medium text-zinc-700 dark:text-zinc-300";

/** Back link on guide pages */
export const docsBackLink =
  `inline-flex items-center text-sm text-zinc-500 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 ${docsFocus} rounded-sm`;
