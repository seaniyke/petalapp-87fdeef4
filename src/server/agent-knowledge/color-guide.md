### 🚨 HSL VALUE FORMAT — get this exactly right or the colors will be WRONG

shadcn CSS variables store **HSL components separated by spaces**, in the EXACT format `H S% L%`:
- `H` = hue, 0–360, **no unit suffix**
- `S` = saturation, 0–100, **MUST have a `%` suffix**
- `L` = lightness, 0–100, **MUST have a `%` suffix**

Tailwind wraps these as `hsl(var(--primary))` at render time. If you forget the `%` signs, or pass RGB/hex, the browser interprets the numbers as something entirely different and the site renders in a completely wrong color (e.g. terracotta → neon teal).

**CORRECT:**
```css
--primary: 20 75% 45%;           /* terracotta — H=20°, S=75%, L=45% */
--primary: 166 74% 46%;          /* teal */
--background: 40 60% 98%;        /* warm cream */
```

**WRONG (all of these produce broken color):**
```css
--primary: 166 74 46;            /* ❌ missing `%` signs — hsl(166 74 46) renders as teal, not terracotta */
--primary: #A64A2E;              /* ❌ hex not allowed */
--primary: rgb(166 74 46);       /* ❌ wrapper not allowed */
--primary: 166, 74%, 46%;        /* ❌ commas not allowed (shadcn uses space-separated) */
--primary: hsl(20 75% 45%);      /* ❌ hsl() wrapper not allowed — Tailwind adds it */
--primary: 846 59% 41%;          /* ❌ hue out of 0–360 range — pick a value in 0–360 */
--primary: 20deg 75% 45%;        /* ❌ `deg` suffix not allowed — Tailwind wraps with hsl() which supplies the unit */
--primary: -10 59% 41%;          /* ❌ negative hue — shadcn HSL vars must be 0–360 */
```

**Hue must be an integer in 0–360 (no `deg` suffix).** If you compute a hue outside that range (e.g. by adding offsets), normalize it with modulo before writing: `846 mod 360 = 126` (green). Values like `846` or `-10` signal a mis-computed colour — the post-build quality check flags them as warnings.

**Workflow for converting a named color → HSL components:**
1. Start with the target hex (e.g. "Terracotta #A64A2E").
2. Convert hex → HSL: `#A64A2E` = `hsl(11°, 57%, 41%)`.
3. Write the three components **space-separated, with `%` on the second and third**: `11 57% 41%`.
4. Double-check: would `hsl(11 57% 41%)` produce the named color you wanted? If you'd write hue=20° for orange/terracotta, don't accidentally write 166° (which is teal).

If you're unsure of the HSL conversion, pick a well-known HSL value from memory (orange ≈ 20–35°, red ≈ 0–15°, yellow ≈ 45–60°, green ≈ 100–140°, teal/cyan ≈ 160–190°, blue ≈ 200–240°, purple ≈ 260–290°, pink ≈ 320–340°) instead of guessing numbers.
