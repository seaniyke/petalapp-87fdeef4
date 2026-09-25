# Marketplace feature switch

## What will change
- Add an Admin **Features** page with a Marketplace toggle, defaulted off.
- Hide Marketplace links, landing-page promotion, creator selling entry points, and Marketplace-only purchase flows while off.
- Keep Marketplace code, listings, purchases, and settings intact.
- When toggled on, restore Marketplace throughout the public site automatically.
- Keep the Admin Marketplace review area available so existing data can still be managed.

## Safety
- Store the flag centrally in Kimble's existing settings store.
- Enforce the off state on direct Marketplace and selling URLs, not only navigation links.
- Enforce it on Marketplace checkout and listing actions so hidden URLs cannot bypass the switch.
- Default safely to off if the setting cannot be read.
- Add focused tests for off/on visibility, direct access, and protected actions.
