/**
 * Tool-call validation guard.
 *
 * Why this exists:
 *   Cheaper models (DeepSeek V3, some Gemini Flash variants) emit ~3% malformed
 *   tool_calls at production scale — wrong arg names, missing required fields,
 *   even invented tool names. Stronger models like Claude Sonnet 4.5 / GPT-5 sit
 *   around 0.5%. If we route a feature like `triage` to a cheap model we want a
 *   safety net: validate the call against the JSON schema BEFORE we hand it to
 *   the executor, and fail fast (or trigger a one-shot fallback retry) when the
 *   args don't match.
 *
 * This is intentionally framework-free (no zod, no ajv) so it adds zero deps.
 * It handles the 80% of schema features that matter for our tool definitions:
 *   - type: object / string / number / integer / boolean / array
 *   - required: [...]
 *   - properties: {...}
 *   - enum: [...]
 *   - items: {...}
 *
 * For anything more elaborate, callers should run their own zod parse on top.
 */

export type JsonSchema = {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  enum?: unknown[];
  items?: JsonSchema;
  // Anything else is ignored — we accept it.
};

export interface ToolCallValidation {
  valid: boolean;
  /** Human-readable reason for the first failure, if any. */
  error?: string;
  /** Path to the offending field, e.g. `args.pages[0].title`. */
  path?: string;
}

/**
 * Validate a single tool call's parsed arguments against a JSON schema.
 *
 * Usage:
 *   const v = validateToolCallArgs(parsedArgs, tool.function.parameters);
 *   if (!v.valid) {
 *     // Decide: retry with stronger model, or surface friendly error.
 *   }
 */
export function validateToolCallArgs(
  args: unknown,
  schema: JsonSchema | undefined,
): ToolCallValidation {
  if (!schema) return { valid: true };
  return walk(args, schema, "args");
}

function walk(value: unknown, schema: JsonSchema, path: string): ToolCallValidation {
  // enum first — most restrictive.
  if (schema.enum && !schema.enum.includes(value as never)) {
    return {
      valid: false,
      path,
      error: `Expected one of ${JSON.stringify(schema.enum)} at ${path}`,
    };
  }

  const types = Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : [];

  if (types.length > 0 && !types.some((t) => matchesType(value, t))) {
    return {
      valid: false,
      path,
      error: `Expected type ${types.join("|")} at ${path}, got ${describe(value)}`,
    };
  }

  // Object: check required + recurse properties.
  if (types.includes("object") && value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const req of schema.required ?? []) {
      if (!(req in obj)) {
        return { valid: false, path: `${path}.${req}`, error: `Missing required field ${req}` };
      }
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in obj) {
        const r = walk(obj[key], sub, `${path}.${key}`);
        if (!r.valid) return r;
      }
    }
  }

  // Array: validate every item.
  if (types.includes("array") && Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const r = walk(value[i], schema.items, `${path}[${i}]`);
      if (!r.valid) return r;
    }
  }

  return { valid: true };
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return true; // Unknown type — be permissive.
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Convenience: parse a raw `arguments` string from the model and validate it
 * in one shot. Returns null args + a validation error if JSON parsing fails.
 */
export function parseAndValidateToolCall(
  rawArgs: string,
  schema: JsonSchema | undefined,
): { args: unknown | null; validation: ToolCallValidation } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArgs);
  } catch (err) {
    return {
      args: null,
      validation: {
        valid: false,
        path: "args",
        error: `Tool call arguments are not valid JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
    };
  }
  return { args: parsed, validation: validateToolCallArgs(parsed, schema) };
}
