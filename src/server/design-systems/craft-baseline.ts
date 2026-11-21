/**
 * Universal craft baseline — appended to EVERY design-system playbook.
 *
 * Packages differ in mood (palette, type pairing, radius character, motion
 * tempo). They never differ on modern fundamentals: information hierarchy,
 * copy restraint, breathing room, fluid forms and plain-language voice. One
 * place, so a single package can never reintroduce 2010-era boxes or a
 * developer-console voice for a business that is not a developer tool.
 */
export const CRAFT_BASELINE = `### Universal craft baseline (applies to every package; the package above sets mood only)
- Hierarchy on every page: (1) one confident statement + one short line + one action; (2) scannable items — name, one line, the key number (price, time, size), an action; (3) fine print — policies, prep, terms, FAQs — lives in \`<Disclosure>\` from \`@/components/flow\` or a sheet, never as banners or paragraphs on the main canvas.
- Copy restraint: a section is a headline plus at most two short sentences. Cut anything a visitor would skim past.
- Voice matches the audience. Technical notation (\`01 //\`, item codes, coordinates, monospace spec labels, words like protocol/specification/dispatch) appears ONLY when the product itself is for developers or engineers. "Looks like Vercel/Linear/Apple" means their craft (type, spacing, light, motion), never their jargon.
- Breathing room: generous section spacing, wide gutters, imagery allowed to go full-bleed. Content is never cramped inside bordered boxes.
- Forms are experiences: \`<StepFlow>\` for anything over four fields, \`<ChoiceGrid>\` for choices instead of selects/radios, large inputs, one decision per step.
- Depth and motion follow the package's tempo, but every page has at least one moment of movement and one layered surface (\`<Surface>\`, \`glass\`, imagery behind content).`;
