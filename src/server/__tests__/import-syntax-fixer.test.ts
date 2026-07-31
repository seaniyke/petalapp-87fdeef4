import { describe, expect, it } from "vitest";
import { repairImportSyntax } from "../import-syntax-fixer.server";

describe("repairImportSyntax", () => {
  it("restores a missing `from` on a named import", () => {
    const src = `import { Separator } '@/components/ui/separator';\n`;
    const { out, count } = repairImportSyntax(src);
    expect(count).toBe(1);
    expect(out).toBe(`import { Separator } from '@/components/ui/separator';\n`);
  });

  it("handles default, namespace, type and multi-line clauses", () => {
    const src = [
      `import React "react";`,
      `import * as z 'zod';`,
      `import type { A } "./a";`,
      `import {`,
      `  Tabs,`,
      `  TabsList,`,
      `} '@/components/ui/tabs';`,
    ].join("\n");
    const { out, count } = repairImportSyntax(src);
    expect(count).toBe(4);
    expect(out).toContain(`import React from "react";`);
    expect(out).toContain(`import * as z from 'zod';`);
    expect(out).toContain(`import type { A } from "./a";`);
    expect(out).toContain(`} from '@/components/ui/tabs';`);
  });

  it("fixes `from` typos", () => {
    const { out } = repairImportSyntax(`import { Badge } form '@/components/ui/badge';`);
    expect(out).toBe(`import { Badge } from '@/components/ui/badge';`);
  });

  it("leaves valid imports and side-effect imports untouched", () => {
    const src = `import { Badge } from '@/b';\nimport './styles.css';\nimport x from "y";\n`;
    const { out, count } = repairImportSyntax(src);
    expect(count).toBe(0);
    expect(out).toBe(src);
  });
});
