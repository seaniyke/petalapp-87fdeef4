# Proof-led repairs: live validation, 24 November 2026

## Scope and deployment

- Live service tested through `https://api.custardai.dev/api/public/v1`.
- Builder health reports `2026-11-24-proof-led-repairs` with core hash `589909974913dd94abb56a7f6d8818608599080ebfabfbef18900699d6c86abe`, matching the committed bundle.
- Isolated service-account project: `ac121bea-49fc-41f8-a015-c76ae8d92a0b`. No existing customer project changed. Default partner notifications disabled for these test calls.
- One-page fitness website followed by a narrow description edit. This is a smoke test, not a matched replay of the earlier hospitality app.

## Results

| Metric | Historical evidence | New smoke-test evidence | Interpretation |
|---|---|---|---|
| Recorded local verification pass | 6/10 on 23 November: 60% | 2/2: 100% | +40 percentage points in this small, different sample; not a general quality guarantee |
| Final delivery success | Digest reported 100% | 2/2: 100% | No change in this sample |
| Initial generation cost | Shiftwell: $5.622 | $0.641535 | Different scope; no attributable savings percentage |
| Follow-up costs | Shiftwell six non-initial turns: $5.898433 and 36 calls | One successful text edit: $0.140977 and one call | Different task count and scope; not comparable repair savings |
| New retry / recovery calls | Historical chain contained failures and no-ops | Zero on both new turns | Neither new turn exercised a failing autonomous repair |

Costs above are recorded variable-cost estimates (`cost_basis=estimated`), not invoices or cash paid. New credits recorded: 15.39 initial, 3.95 edit. Initial call models include Argon and Flash; edit used Flash.

The digest's local verification metric must **not** be described as unmodified raw-model first-pass accuracy: source fixes happen before the recorded local verdict. New outcome records include autofix counts of 97 and 47; those counts are not evidence of 97/47 AI retries.

## End-to-end evidence

- Initial turn `f8549256-ef55-492e-883f-7a2683273092`, ready build `f9fbcb73-526e-4f5e-9d73-4f16ec7f96aa`, revision 2.
- Edit turn `8e95e217-da7a-4ea8-9df7-d5fd91313c65`, ready build `6413c80c-3c1e-410d-888d-20c738145630`, revision 3.
- Browser visits to the real delivered site at 390×844 and 1280×1800: no page errors; document width equalled viewport width at both sizes.
- Edited description read back as “Thank you for training with us.” Services, membership and opening-hours sections remained present.
- 22 targeted tests passed (19 proof-led repairs tests, three existing cost-routing tests).

## Remaining validation

1. Replay a genuine implicated-stylesheet repair; a healthy text edit does not exercise the expanded repair boundary.
2. Exercise unchanged-defect stopping through a real autonomous repair, not just unit tests.
3. Obtain an exact pre-fix request/source fixture and compare an equivalent successful task under both versions in isolation. Do not replace the live builder with the older version.
4. Expand beyond two turns and verify no loss of requested functionality.

Cost reduction attributable to these fixes remains **unmeasured**, not 0%. Formula once matched evidence exists: `(before cost − after cost) / before cost × 100`. Compare total recorded cost per equivalent successful task, including failed/retried work.

## Additional finding

The initial prompt explicitly excluded bookings, accounts and payment processing, yet generated requirement/progress text listed those as requested items. The delivered one-page site was usable, but this is evidence of a separate negation/requirement-extraction issue. Do not treat the progress list as proof of missing requested features or claim the engine is fully validated. No behaviour changed during this validation.