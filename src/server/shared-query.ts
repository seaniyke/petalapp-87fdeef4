/**
 * Server-side query rules for shared-tier records (pure, unit-tested).
 *
 * Generated apps send `where` (JSON) and `sort` with `db.list`; this module
 * turns them into a small, validated set of filters over the record's JSON
 * `data`, so filtering, sorting and paging happen in the database instead of
 * the visitor's browser. Anything unknown is rejected — never passed through.
 */

export type FilterOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "contains";
export type Scalar = string | number | boolean | null;

export type Filter =
  | { op: Exclude<FilterOp, "in">; field: string; value: Scalar }
  | { op: "in"; field: string; value: Scalar[] };

export type Sort = { field: string; ascending: boolean };

export type ParsedQuery = { filters: Filter[]; sort: Sort | null };

export const QUERY_LIMITS = { maxFilters: 10, maxInValues: 50, maxValueLength: 500 } as const;

/** Record columns that can be filtered/sorted as well as `data` fields. */
export const COLUMN_FIELDS: Record<string, string> = {
  id: "id",
  createdAt: "created_at",
  created_at: "created_at",
  updatedAt: "updated_at",
  updated_at: "updated_at",
};

const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const OPS = new Set<FilterOp>(["eq", "ne", "gt", "gte", "lt", "lte", "in", "contains"]);

export class QueryError extends Error {}

function scalar(v: unknown, field: string): Scalar {
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    if (v.length > QUERY_LIMITS.maxValueLength) throw new QueryError(`Filter value for "${field}" is too long`);
    return v;
  }
  throw new QueryError(`Filter value for "${field}" must be text, a number, true/false or null`);
}

function checkField(field: string): string {
  if (!FIELD_RE.test(field)) throw new QueryError(`Invalid field name "${field.slice(0, 64)}"`);
  return field;
}

/** Parse the `where` JSON: `{ category: "dessert", price: { lte: 20 }, tag: { in: ["a","b"] } }`. */
export function parseWhere(raw: string | null): Filter[] {
  if (!raw) return [];
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new QueryError("where must be valid JSON");
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new QueryError("where must be an object");
  const filters: Filter[] = [];
  for (const [rawField, cond] of Object.entries(obj as Record<string, unknown>)) {
    const field = checkField(rawField);
    if (cond !== null && typeof cond === "object" && !Array.isArray(cond)) {
      for (const [op, v] of Object.entries(cond as Record<string, unknown>)) {
        if (!OPS.has(op as FilterOp)) throw new QueryError(`Unknown filter "${op.slice(0, 20)}" on "${field}"`);
        if (op === "in") {
          if (!Array.isArray(v) || v.length === 0) throw new QueryError(`"in" on "${field}" needs a non-empty list`);
          if (v.length > QUERY_LIMITS.maxInValues) throw new QueryError(`"in" on "${field}" has too many values`);
          filters.push({ op: "in", field, value: v.map((x) => scalar(x, field)) });
        } else if (op === "contains") {
          if (typeof v !== "string" || !v) throw new QueryError(`"contains" on "${field}" needs text`);
          filters.push({ op: "contains", field, value: scalar(v, field) });
        } else {
          filters.push({ op: op as Exclude<FilterOp, "in">, field, value: scalar(v, field) });
        }
      }
    } else {
      filters.push({ op: "eq", field, value: scalar(cond, field) });
    }
  }
  if (filters.length > QUERY_LIMITS.maxFilters) throw new QueryError("Too many filters");
  return filters;
}

/** Parse `sort`: `"price"` (ascending) or `"-price"` (descending). Default: newest first. */
export function parseSort(raw: string | null): Sort | null {
  if (!raw) return null;
  const desc = raw.startsWith("-");
  const field = checkField(desc ? raw.slice(1) : raw);
  return { field, ascending: !desc };
}

export function parseRecordQuery(params: URLSearchParams): ParsedQuery {
  return { filters: parseWhere(params.get("where")), sort: parseSort(params.get("sort")) };
}

/**
 * The PostgREST column path for a field. Text equality/`in`/`contains` compare
 * the text value (`data->>f`); numbers and booleans compare the JSON value
 * (`data->f`) so 9 < 10 numerically, not alphabetically.
 */
export function columnFor(field: string, value: Scalar | Scalar[] | undefined): string {
  if (COLUMN_FIELDS[field]) return COLUMN_FIELDS[field];
  const sample = Array.isArray(value) ? value[0] : value;
  return typeof sample === "number" || typeof sample === "boolean" ? `data->${field}` : `data->>${field}`;
}

/** Escape LIKE wildcards so `contains: "50%"` matches the literal text. */
export function likePattern(v: string): string {
  return `%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Sort path: record columns directly, data fields as JSON so numbers sort numerically. */
export function sortColumn(field: string): string {
  return COLUMN_FIELDS[field] ?? `data->${field}`;
}
