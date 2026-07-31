import { strict as assert } from "node:assert";
import { repairImportSyntax, fixImportSyntax } from "../import-syntax-fixer.server";

// 1. The production crash: named import with the `from` keyword dropped.
const one = repairImportSyntax(`import { Separator } '@/components/ui/separator';\n`);
assert.equal(one.count, 1);
assert.equal(one.out, `import { Separator } from '@/components/ui/separator';\n`);

// 2. Default, namespace, type-only and multi-line clauses.
const many = repairImportSyntax(
  [
    `import React "react";`,
    `import * as z 'zod';`,
    `import type { A } "./a";`,
    `import {`,
    `  Tabs,`,
    `  TabsList,`,
    `} '@/components/ui/tabs';`,
  ].join("\n"),
);
assert.equal(many.count, 4);
assert.ok(many.out.includes(`import React from "react";`));
assert.ok(many.out.includes(`import * as z from 'zod';`));
assert.ok(many.out.includes(`import type { A } from "./a";`));
assert.ok(many.out.includes(`} from '@/components/ui/tabs';`));

// 3. `from` misspellings.
assert.equal(
  repairImportSyntax(`import { Badge } form '@/components/ui/badge';`).out,
  `import { Badge } from '@/components/ui/badge';`,
);

// 4. Valid and side-effect imports are untouched (and the pass is idempotent).
const valid = `import { Badge } from '@/b';\nimport './styles.css';\nimport x from "y";\n`;
const untouched = repairImportSyntax(valid);
assert.equal(untouched.count, 0);
assert.equal(untouched.out, valid);

// 5. Only source files are rewritten.
const res = fixImportSyntax([
  { path: "src/routes/products/$slug.tsx", content: `import { Separator } '@/s';\n` },
  { path: "README.md", content: `import { Separator } '@/s';\n` },
]);
assert.equal(res.notes.length, 1);
assert.ok(res.files[0].content.includes(`from '@/s'`));
assert.equal(res.files[1].content, `import { Separator } '@/s';\n`);
assert.equal(fixImportSyntax(res.files).notes.length, 0);

console.log("import-syntax-fixer: all assertions passed");
