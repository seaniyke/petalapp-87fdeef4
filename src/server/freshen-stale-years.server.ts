/**
 * Post-generation pass that rewrites obviously-stale years in user-facing
 * copy (footers, copyright lines, "© 2024 Acme") to the actual current year.
 *
 * Why: LLM training data has a knowledge cutoff (~2024). Without an explicit
 * date in the system prompt, models default to writing `© 2024` everywhere.
 * We already inject the current date into prompts going forward, but this
 * second-line defense catches any drift on every shipped build.
 *
 * Scope is intentionally narrow — only year tokens that look like a copyright
 * notice — to avoid touching numeric data, dates inside seed records, etc.
 */
import type { ProjectFile } from "@/server/generate.server";

// File extensions where we'll consider rewriting. Skip JSON, lockfiles,
// images, etc. to avoid corrupting data.
const TEXT_EXT = /\.(tsx?|jsx?|html?|md|mdx|css|svelte|vue|astro)$/i;

// Match years 2020–2025 that look like a copyright marker:
//   "© 2024", "&copy; 2024", "Copyright 2024", "(c) 2024",
//   "© 2023-2024", "Copyright © 2024 Acme", etc.
// We DON'T match bare years (e.g. dates in code or seed data).
const COPY_YEAR_RE =
  /(©|&copy;|\(c\)|\(C\)|copyright[\s©&;cop]*?)(\s*)(20(?:1[5-9]|2[0-5]))(\s*[-–—]\s*20(?:1[5-9]|2[0-5]))?/g;

function currentYear(): number {
  return new Date().getUTCFullYear();
}

export function freshenStaleYearsInString(
  source: string,
  year: number = currentYear(),
): { content: string; replacements: number } {
  let count = 0;
  const out = source.replace(COPY_YEAR_RE, (full, prefix, gap, startYear, range) => {
    const startN = Number(startYear);
    if (range) {
      // "© 2020 - 2024" → "© 2020 - {year}" (only bump the end)
      const endMatch = range.match(/20(?:1[5-9]|2[0-5])/);
      if (!endMatch) return full;
      const endN = Number(endMatch[0]);
      if (endN >= year) return full;
      count++;
      return `${prefix}${gap}${startYear}${range.replace(endMatch[0], String(year))}`;
    }
    if (startN >= year) return full;
    count++;
    return `${prefix}${gap}${year}`;
  });
  return { content: out, replacements: count };
}

export function freshenStaleYears(
  files: ProjectFile[],
  year: number = currentYear(),
): { files: ProjectFile[]; replacements: number } {
  let total = 0;
  const next = files.map((f) => {
    if (!TEXT_EXT.test(f.path)) return f;
    const { content, replacements } = freshenStaleYearsInString(f.content, year);
    if (replacements === 0) return f;
    total += replacements;
    return { ...f, content };
  });
  return { files: next, replacements: total };
}
