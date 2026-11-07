/**
 * Customer-page privacy check — run on every write in the build loop.
 *
 * A shop or booking website shares one database between every visitor. Two
 * mistakes kept shipping (Allure Bar, 7 Nov 2026):
 *  1. The public site loaded the whole bookings/orders collection, so every
 *     visitor saw other customers' names, notes and appointments, with
 *     Reschedule / Release buttons on them.
 *  2. The public site could add products to the store ("Bespoke Blend →
 *     Add to Store"), whatever the button was called.
 *
 * Both are detected from the real data calls, not from button labels, and
 * returned to the writer as validation feedback so the same file is fixed.
 */
import type { ProjectFile } from "@/server/generate.server";

const KIT_PATH = /^src\/(integrations|components\/(ui|examples|blocks|fx|mobile|content|image))\//;
const SIGNED_IN_PATH = /(dashboard|admin|staff|owner|manage|backoffice|back-office|portal|account|studio-os|console)/i;

/** People's private records: one visitor must never read another's. */
const PRIVATE = /(^|[_-])(bookings?|appointments?|reservations?|orders?|messages?|enquir(y|ies)|inquir(y|ies)|leads?|submissions?|requests?|customers?|clients?|patients?|subscribers?|registrations?|rsvps?|carts?|bags?|baskets?)$/i;
/** What the business sells: visitors browse it, never change it. */
const CATALOGUE = /(^|[_-])(products?|services?|treatments?|menu(_items)?|menus|catalog(ue)?s?|formulas?|formulations?|offerings?|packages?|classes|courses?|listings?|collections?|rooms?)$/i;

const CALL = /\bdb\.(seedOnce|list|create|update|remove|delete|upsert)\s*(?:<[^>()]*>)?\s*\(\s*(["'`])([\w-]+)\2([^)]{0,160})/g;

function isSource(path: string): boolean {
  return /\.(tsx?|jsx?)$/.test(path);
}

function hasSignedInArea(tree: ProjectFile[], file: ProjectFile): boolean {
  if (/<RequireAuth\b/.test(file.content)) return true;
  return tree.some((f) => f.path !== file.path && isSource(f.path) && /<RequireAuth\b/.test(f.content));
}

/** Files a signed-out visitor's browser runs as part of the public site. */
function isCustomerFacing(file: ProjectFile, tree: ProjectFile[]): boolean {
  if (!isSource(file.path) || KIT_PATH.test(file.path)) return false;
  if (SIGNED_IN_PATH.test(file.path) || /<RequireAuth\b/.test(file.content)) return false;
  // With a signed-in area, shared modules may legitimately serve staff
  // screens too; only the public route pages are judged.
  if (hasSignedInArea(tree, file)) return /^src\/pages\//.test(file.path);
  return true;
}

export function customerPrivacyIssues(file: ProjectFile, tree: ProjectFile[]): string[] {
  if (!isCustomerFacing(file, tree)) return [];
  const out = new Set<string>();
  CALL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CALL.exec(file.content))) {
    const op = m[1]!;
    const collection = m[3]!;
    const rest = m[4] ?? "";
    if (PRIVATE.test(collection)) {
      if (op === "seedOnce") {
        out.add(
          `${file.path}: db.seedOnce("${collection}") fills the shared "${collection}" collection with made-up customers that every visitor then sees. ` +
            `Seed only what the business sells (products, treatments). Remove this seed; "${collection}" starts empty and is only written by db.create when a visitor books or orders.`,
        );
      } else if (op === "list" && !/\bmine\s*:\s*true\b/.test(rest)) {
        out.add(
          `${file.path}: db.list("${collection}") loads EVERY visitor's ${collection} into a public page, so customers see each other's names and details. ` +
            `A visitor only sees their own: after db.create, keep the saved record in component state (or localStorage) and show that confirmation. ` +
            `Remove this list call and any list of other people's ${collection} (with reschedule, cancel or release buttons).`,
        );
      } else if (op === "update" || op === "remove" || op === "delete" || op === "upsert") {
        out.add(
          `${file.path}: db.${op}("${collection}") lets any visitor change or cancel other customers' ${collection}. ` +
            `Public pages only create new ${collection}; remove this ${op} function and the buttons that call it.`,
        );
      }
      continue;
    }
    if (CATALOGUE.test(collection) && op !== "seedOnce" && op !== "list") {
      out.add(
        `${file.path}: db.${op}("${collection}") lets any visitor change the store's ${collection}, whatever the button is called. ` +
          `Visitors only browse, add to bag, book and pay. Remove this function and the form or button that calls it.`,
      );
    }
  }
  return [...out];
}
