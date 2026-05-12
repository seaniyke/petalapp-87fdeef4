/**
 * Domain Knowledge Packs — Step 6 of the 500-system expansion.
 *
 * For each vertical in the system catalog we ship a ~150-word block of
 * "what users actually expect on day 1": canonical data shapes, the state
 * machine, vocabulary, and the most common rookie mistakes. The pack is
 * injected into the system prompt ONLY when the semantic router matches
 * an archetype in that vertical — so prompt size stays flat regardless
 * of how many packs we add.
 *
 * Why a separate file: keeps templates.server.ts focused on routes/blocks
 * and lets us iterate on domain wording without touching the kit.
 *
 * Hard rule: every pack is presentational guidance for UI. Nothing here
 * authorises real money movement, real PHI handling, or real legal advice
 * — those stay gated by the reality tier on the archetype.
 */

import type { Vertical, ArchetypeSpec } from "./system-catalog.server";

interface DomainPack {
  vertical: Vertical;
  /** One-line label used in admin/debug logging. */
  label: string;
  /** Body — injected verbatim under a per-vertical heading. Keep ≤220 words. */
  body: string;
}

/** Strip leading/trailing whitespace on every line so multiline template
 *  literals stay readable in source but render compact in the prompt. */
function compact(s: string): string {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

const PACKS: Record<Vertical, DomainPack> = {
  saas: {
    vertical: "saas",
    label: "SaaS product",
    body: compact(`
      Data shapes: Workspace → Members(role: owner|admin|member) → Projects → Items.
      Billing object: Subscription(status: trialing|active|past_due|canceled, plan, seats, renewsAt).
      State machine: signup → email-verify → onboarding(workspace + invite) → trial → paid.
      Day-1 expectations: empty-state with a "create your first X" CTA, recent activity feed,
      seat-aware billing page, role-gated settings, /docs and /changelog links in the footer.
      Vocabulary: "workspace" not "org", "member" not "user", "seats" not "licenses".
      Common mistakes: hiding the upgrade path inside Settings, forgetting trial countdown banner,
      treating admins and owners as the same role, no audit log for destructive actions.
    `),
  },
  marketplace: {
    vertical: "marketplace",
    label: "Two-sided marketplace",
    body: compact(`
      Data shapes: Listing(seller, category, price, status: draft|active|sold|paused),
      Order(buyer, listing, status: requested|accepted|paid|shipped|delivered|disputed),
      Review(rating, body, role: buyer|seller).
      State machine: browse → listing-detail → request → seller-accept → checkout → fulfillment → review.
      Day-1 expectations: search + faceted filters, trust signals (verified seller badge, rating count),
      seller dashboard distinct from buyer dashboard, dispute escalation path, saved searches.
      Vocabulary: "listing" not "product" when peer-to-peer, "host"/"guest" for rentals.
      Common mistakes: one dashboard for both sides, missing message thread per order, hiding fees
      until checkout, no empty-state for new sellers ("list your first item").
    `),
  },
  ecommerce: {
    vertical: "ecommerce",
    label: "E-commerce store",
    body: compact(`
      Data shapes: Product(variants: [{sku, size, color, price, stock}]), Cart(items, subtotal, shipping, tax, total),
      Order(status: pending|paid|fulfilled|shipped|delivered|refunded), Customer(addresses, defaultPayment).
      State machine: browse → PDP → add-to-cart → checkout(address → shipping → payment → review) → confirmation → tracking.
      Day-1 expectations: hero category bento, sticky add-to-cart, size guide, free-shipping threshold bar,
      trust badges, related products, order-tracking page, address book, wishlists.
      Vocabulary: "PDP" (product detail page), "PLP" (product listing page), "SKU", "variant".
      Common mistakes: hiding total cost until the last step, forgetting guest checkout, no inventory state
      ("only 2 left"), single-image PDP, no order confirmation email scaffold.
    `),
  },
  "content-media": {
    vertical: "content-media",
    label: "Content / media site",
    body: compact(`
      Data shapes: Article(title, slug, author, publishedAt, tags, hero, body MDX), Author(bio, avatar, social),
      Series/Section, Episode(audio/video), Newsletter(issue, subject, sentAt).
      Day-1 expectations: editorial typography, table-of-contents on long reads, author byline + bio card,
      related articles, share buttons, newsletter signup at the foot of every article, RSS link, dark mode.
      SEO non-negotiables: per-article meta + og:image set to the hero, JSON-LD Article schema, canonical URL.
      Vocabulary: "issue" for newsletters, "episode" for podcasts, "story" or "post" for articles.
      Common mistakes: reusing the home page meta on every article, no reading-time estimate, sidebar ads
      that crowd the column, broken share images.
    `),
  },
  education: {
    vertical: "education",
    label: "Education / learning",
    body: compact(`
      Data shapes: Course(modules → lessons → quizzes), Enrollment(progress %, lastLessonId),
      Cohort(startDate, students), Certificate(issuedAt, verifyUrl).
      State machine: browse-catalog → preview → enroll → in-progress → complete → certificate.
      Day-1 expectations: curriculum outline with locked/completed states, persistent progress bar,
      lesson video player + transcript + notes, quiz with instant feedback, dashboard of enrolled courses,
      certificate download. Mobile-friendly because most learners are on phones.
      Vocabulary: "course" / "module" / "lesson" / "cohort" — keep them distinct.
      Common mistakes: no resume-where-you-left-off, hiding the syllabus behind purchase, treating quizzes
      as final exams (they're checkpoints), forgetting offline/PDF resource links.
    `),
  },
  "health-fitness": {
    vertical: "health-fitness",
    label: "Health & fitness (UI demo only)",
    body: compact(`
      Data shapes: Workout(exercises[] with sets/reps/weight), Plan(weeks → days → workouts),
      LoggedSession(date, durationMin, notes), HealthMetric(weight, sleep, hr, steps).
      Day-1 expectations: today-view first (what to do right now), streak counter, simple log form,
      weekly summary chart, plan picker, rest-day support. For telehealth/clinical: appointment list,
      intake form, consent panel — visible "DEMO — not medical advice" banner is mandatory.
      Vocabulary: "session" not "workout entry", "PR" (personal record), "rest day" not "skip day".
      Common mistakes: gamifying so hard it shames missed days, dense data tables instead of charts,
      no privacy assurance copy, suggesting clinical decisions in a demo.
    `),
  },
  finance: {
    vertical: "finance",
    label: "Finance / fintech (DEMO)",
    body: compact(`
      Data shapes: Account(balance, currency, type), Transaction(amount, merchant, category, postedAt),
      Budget(category, monthlyCap, spent), Goal(name, target, contributed).
      Day-1 expectations: balance hero with quick-actions (Send/Request/Top-up), grouped transaction list,
      monthly spend chart, budget progress bars, account switcher. Crypto/trading variants: portfolio table,
      ticker strip, simulated order ticket. Visible "DEMO — simulated balances, not real funds" banner is mandatory.
      Vocabulary: "transaction" / "transfer" / "payee" / "statement period". Currency formatting per locale.
      Common mistakes: real-money copy ("withdraw to bank"), missing demo banner, no empty state, mixing
      crypto and fiat balances in one number, fake "Connect Plaid" buttons that do nothing.
    `),
  },
  productivity: {
    vertical: "productivity",
    label: "Productivity / work tools",
    body: compact(`
      Data shapes: Project → List → Task(status, assignee, dueDate, priority, labels), Comment(thread, mentions),
      View(kanban|list|calendar|gantt). Recurring tasks need a rule, not duplicates.
      Day-1 expectations: keyboard-first ("c" to create, "/" to search), drag-to-reorder, multi-select bulk actions,
      view switcher persisted per user, inbox/notifications, today + upcoming filters, quick-add bar.
      Vocabulary: "task" / "subtask" / "assignee" / "due" — keep "owner" for projects, "assignee" for tasks.
      Common mistakes: cluttered task row (show 3 facts max: title, assignee, due), modal-heavy editing
      (prefer side-panel), forgetting empty-state "create your first task", no keyboard shortcut help.
    `),
  },
  "social-community": {
    vertical: "social-community",
    label: "Social / community",
    body: compact(`
      Data shapes: User(handle, avatar, bio), Post(author, body, media, replyCount, likeCount),
      Thread(rootPost, replies tree), Reaction, Follow(follower → followee), Notification.
      Day-1 expectations: feed with infinite scroll, compose box pinned, profile page with tabs (posts/replies/media),
      threaded replies (collapse deep nesting), notifications inbox, search, basic mute/block. Mobile-first by default.
      Vocabulary: "post" or "thread" not "tweet", "reply" not "comment" in microblog UX, "follow" / "follower".
      Common mistakes: putting moderation behind unfindable menus, no empty feed state for new users (suggest who to follow),
      reactions count without showing who reacted, hiding new-post composer on mobile.
    `),
  },
  creator: {
    vertical: "creator",
    label: "Creator tools",
    body: compact(`
      Data shapes: CreatorProfile(handle, bio, links), Post/Drop(scheduledAt, audienceTier),
      Subscriber(tier, joinedAt, monthlyContribution), DM/Message.
      Day-1 expectations: link-in-bio style landing, schedule view, subscriber list with tier badges,
      revenue chart (simulated if no payments wired), DM inbox, content calendar.
      Vocabulary: "drop" or "post" not "article", "tier" not "plan", "supporter" or "subscriber".
      Common mistakes: assuming every creator wants paid tiers (offer free-only mode), cluttered analytics
      ("vanity metrics"), no preview-as-fan toggle, hiding share assets behind submenus.
    `),
  },
  "local-services": {
    vertical: "local-services",
    label: "Local services / booking",
    body: compact(`
      Data shapes: Service(name, durationMin, price), Provider(name, schedule, services[]),
      Booking(client, service, provider, startsAt, status: requested|confirmed|completed|cancelled|no_show).
      State machine: browse-services → pick-time → enter-details → confirm → reminder → complete → review.
      Day-1 expectations: service list with prices, time-slot picker that respects business hours, party-size stepper,
      confirmation screen with .ics download, SMS/email reminder mention, cancellation policy, map + directions.
      Vocabulary: "appointment" / "booking" / "stylist|barber|trainer" — match the trade.
      Common mistakes: showing 24/7 availability, no buffer between slots, no client history on rebook,
      forgetting timezone display, hiding the cancellation rules until after booking.
    `),
  },
  "real-estate": {
    vertical: "real-estate",
    label: "Real estate",
    body: compact(`
      Data shapes: Listing(address, price, beds, baths, sqft, photos[], status: for-sale|pending|sold),
      Inquiry(buyer, listing, message, status), Agent(profile, listings[]), SavedSearch.
      Day-1 expectations: hero photo carousel, key facts strip (beds/baths/sqft/price/$/sqft), map embed,
      mortgage calculator, schedule-tour CTA, agent contact card, similar homes, save-search.
      Vocabulary: "listing" / "asking price" / "lot size" / "HOA" / "tour" not "viewing".
      Common mistakes: tiny photos, no mobile sticky-CTA to schedule a tour, missing price-per-sqft,
      hiding the agent identity, treating "saved" and "favorited" as different things.
    `),
  },
  travel: {
    vertical: "travel",
    label: "Travel / itineraries",
    body: compact(`
      Data shapes: Trip(destination, dates, travelers), Itinerary(day → segments: flight|stay|activity|transit),
      Stay(name, checkIn, checkOut, guests), Activity(time, durationMin, location).
      Day-1 expectations: timeline view per day, map with pinned stops, packing checklist, budget tracker,
      offline-friendly summary, weather-at-destination. Booking variants: stay search + dates + guests, room cards.
      Vocabulary: "itinerary" / "segment" / "stay" or "lodging" / "leg".
      Common mistakes: no date+guest persistence across pages, mixing local time with home time confusingly,
      forgetting timezones on flights, no day-zero (arrival prep) section.
    `),
  },
  food: {
    vertical: "food",
    label: "Food / restaurant",
    body: compact(`
      Data shapes: MenuSection → MenuItem(name, description, price, dietary[]), Reservation(party, slot, table),
      Order(items, type: dine_in|takeaway|delivery, status: placed|preparing|ready|out_for_delivery|delivered).
      Day-1 expectations: hero with dish photo, menu with allergens/dietary tags, prominent reservation/order CTA,
      hours + map + phone, gallery, press quotes for higher-end. Delivery variants: cart with utensil/notes options,
      delivery-time estimate, tracking pin.
      Vocabulary: "cover" (reserved seat), "BOH/FOH" internal only, "course" for tasting menus.
      Common mistakes: hiding the menu behind a PDF link, no dietary tags, no "today's hours" awareness,
      cart that loses items on refresh, treating delivery and dine-in checkout as identical.
    `),
  },
  events: {
    vertical: "events",
    label: "Events / ticketing",
    body: compact(`
      Data shapes: Event(title, startsAt, endsAt, venue, capacity), TicketTier(name, price, qtyAvailable),
      Order(attendee, tickets[], status), Attendee(name, email, qrCode).
      State machine: discover → event-detail → pick-tier → checkout → confirmation(QR) → check-in → post-event.
      Day-1 expectations: hero with date + venue + countdown, agenda/schedule grid, speaker grid, ticket tier cards
      with what's included, sold-out state per tier, QR ticket page, add-to-calendar.
      Vocabulary: "tier" not "type", "agenda" or "schedule", "venue", "doors at".
      Common mistakes: no countdown urgency, hiding what each tier includes, mobile-broken QR page,
      no waitlist for sold-out tiers, forgetting time-zone of the event.
    `),
  },
  nonprofit: {
    vertical: "nonprofit",
    label: "Nonprofit / fundraising",
    body: compact(`
      Data shapes: Campaign(goalAmount, raisedAmount, deadline), Donation(amount, donor, anonymous, message),
      Volunteer(skills, availability), Beneficiary(impact metric).
      Day-1 expectations: thermometer/progress to goal, recent donations feed, suggested amounts (one-time + monthly),
      impact statement ("$25 = 5 meals"), donor wall, story section, volunteer signup, transparency page.
      Vocabulary: "donor" / "supporter" / "monthly giving" / "impact" / "campaign".
      Common mistakes: burying the donate CTA, no monthly option, no tax-receipt copy, generic stock photos
      instead of program photos, missing share-the-campaign affordance.
    `),
  },
  "ai-tools": {
    vertical: "ai-tools",
    label: "AI tools",
    body: compact(`
      Data shapes: Conversation(messages[]), Message(role: user|assistant|system, body, citations[], toolCalls[]),
      Prompt(template, variables[]), Run(input, output, model, tokens, latencyMs).
      Day-1 expectations: chat stream with streaming tokens visible, message bubble with copy/regenerate/like,
      prompt library, model picker, token + latency badge, citation cards under answers, file/image attach,
      empty state with example prompts. Mobile-first chat layout (compose stays pinned to bottom).
      Vocabulary: "prompt" / "completion" / "context" / "tool call" / "citation".
      Common mistakes: no stop-generation button, citations hidden in tooltips, no multiline compose,
      pretending to call tools without showing the trace, forgetting cost/usage transparency.
    `),
  },
  "developer-tools": {
    vertical: "developer-tools",
    label: "Developer tools",
    body: compact(`
      Data shapes: Project(repo, environments[]), Build(commit, status: queued|running|passed|failed, logs),
      Deployment(env, commit, url, status), ApiKey(name, scopes, lastUsed).
      Day-1 expectations: monospace where it matters (logs, code, tokens), status pill colors that work in dark mode,
      copy-button on every key/command, log viewer with search + level filter, dashboard with build success rate,
      docs surface always reachable from nav.
      Vocabulary: "deployment" / "build" / "environment" / "secret" / "webhook".
      Common mistakes: rendering tokens in light text on light background, no copy-paste affordance,
      truncating logs at 1000 lines without a "load more", treating warnings the same as errors visually.
    `),
  },
  "internal-tools": {
    vertical: "internal-tools",
    label: "Internal tools / admin",
    body: compact(`
      Data shapes: ResourceList with Filter/Sort/Pagination, Detail page with related lists,
      AuditLog(actor, action, target, at), Role(perms[]).
      Day-1 expectations: dense table-first UX (Bloomberg energy not landing-page energy), saved filters,
      bulk actions, keyboard navigation, sticky header + first column on wide tables, audit trail accessible
      on every record, role banner showing current actor + impersonation state if applicable.
      Vocabulary: "record" / "resource" / "actor" / "permission" / "impersonate".
      Common mistakes: marketing-spaced cards instead of dense tables, modal everything (prefer drawer/inline),
      no permission gating on dangerous actions, hiding bulk-edit behind right-click.
    `),
  },
  civic: {
    vertical: "civic",
    label: "Civic / government services",
    body: compact(`
      Data shapes: Service(name, eligibility, requiredDocs[]), Application(applicant, status: submitted|review|approved|rejected),
      Notice/Announcement, Petition(target, signatures, goal).
      Day-1 expectations: plain-language copy (8th-grade reading level), accessibility AAA, multilingual toggle,
      service finder with eligibility quiz, document checklist, status tracker, contact-an-officer affordance.
      Vocabulary: "applicant" / "case number" / "agency" / "appointment" — avoid corporate jargon.
      Common mistakes: jargon-laden copy, low-contrast colors, missing keyboard navigation, hiding contact info,
      no Spanish/local-language toggle when audience clearly needs it.
    `),
  },
  legal: {
    vertical: "legal",
    label: "Legal (DEMO — not legal advice)",
    body: compact(`
      Data shapes: Matter(client, type, openedAt, status), Document(version, signedAt, parties[]),
      Intake(form responses, conflictCheck), Invoice(timeEntries[]).
      Day-1 expectations: intake wizard, conflict-check screen, document list with versions, signature blocks
      (visual only in demo), engagement letter preview, time-tracker. Visible "DEMO — not legal advice" banner mandatory.
      Vocabulary: "matter" not "project", "intake" / "engagement" / "billable" / "redline".
      Common mistakes: implying real legal advice, no disclaimer, treating documents as files instead of versioned records,
      missing client portal vs internal staff view distinction.
    `),
  },
  hr: {
    vertical: "hr",
    label: "HR / people ops",
    body: compact(`
      Data shapes: Employee(profile, manager, dept, startDate, status), TimeOff(type, daysOff, status),
      Review(period, ratings, peers[]), JobPosting(role, dept, applicants[]), Application(stage: applied|screen|interview|offer|hired|rejected).
      Day-1 expectations: org chart, directory with search, time-off calendar, review cycle dashboard,
      ATS pipeline (kanban by stage), onboarding checklist, sensitive-data masking by role.
      Vocabulary: "team member" or "employee" / "manager" / "report" / "candidate" / "stage".
      Common mistakes: leaking comp data outside payroll role, no privacy boundary between manager and peer reviews,
      treating the applicant tracker like a generic kanban (it has irreversible stages).
    `),
  },
  logistics: {
    vertical: "logistics",
    label: "Logistics / fleet",
    body: compact(`
      Data shapes: Shipment(origin, destination, status: created|picked_up|in_transit|out_for_delivery|delivered|exception),
      Vehicle(driver, lastPing, fuelLevel), Route(stops[]), Driver(name, license, hoursToday).
      Day-1 expectations: live map with vehicle pins, status timeline per shipment, ETA recalculation,
      exception alerts (delayed/damaged), driver app view (mobile-first), proof-of-delivery (photo + signature).
      Vocabulary: "shipment" / "leg" / "stop" / "POD" (proof of delivery) / "ETA" / "dwell time".
      Common mistakes: no exception state, refresh-required map (must update live), forgetting driver hours-of-service,
      mixing customer-facing tracking with operator dashboard.
    `),
  },
  iot: {
    vertical: "iot",
    label: "IoT / device dashboards",
    body: compact(`
      Data shapes: Device(name, type, status: online|offline|degraded, lastSeen, firmwareVersion),
      Telemetry(metric, value, ts), Alert(severity, device, openedAt), Group(devices[]).
      Day-1 expectations: device grid with status pills, time-series charts (last 1h/24h/7d), alert banner,
      firmware update affordance, device detail with metric panels + log tail, mobile-friendly status check.
      Vocabulary: "device" / "telemetry" / "firmware" / "telemetry channel" / "uptime".
      Common mistakes: charts without unit labels, no alert acknowledgement state, treating offline as an error
      (it can be expected), missing per-device timezone, no bulk firmware roll.
    `),
  },
  games: {
    vertical: "games",
    label: "Games / entertainment",
    body: compact(`
      Data shapes: Game(title, players[], state, currentTurn), Player(name, score, avatar),
      Match(history, winner), Leaderboard(period, entries[]).
      Day-1 expectations: bold motion, sound (with mute toggle), high-contrast UI, scoreboard always visible,
      turn indicator, lobby/matchmaking screen, end-of-round summary with replay, leaderboard with player avatars.
      Vocabulary: "round" / "match" / "lobby" / "ELO" or "rank".
      Common mistakes: muted-by-default with no audio cue toggle anywhere, missing turn timer, leaderboard
      that doesn't scope to friends/global, forgetting mobile-touch-target sizing on game controls.
    `),
  },
};

/* ============================================================
 * Public API
 * ============================================================ */

/** Fetch the pack for a given vertical. Returns null if none registered
 *  (defensive — the catalog could one day add a vertical we haven't packed
 *  yet; we'd rather skip than crash). */
export function getDomainPack(vertical: Vertical): DomainPack | null {
  return PACKS[vertical] ?? null;
}

/** Render the per-vertical pack as a system-prompt block. Returns "" if
 *  no archetype was matched OR no pack exists for its vertical — caller
 *  can append unconditionally. */
export function renderDomainPackBlock(
  archetype: ArchetypeSpec | null,
): string {
  if (!archetype) return "";
  const pack = getDomainPack(archetype.vertical);
  if (!pack) return "";
  return [
    `\n\n### Domain pack — ${pack.label}`,
    `(Injected because the brief matched archetype "${archetype.id}". `,
    `Use this as your day-1 truth for vocabulary, data shapes, and UI expectations.)`,
    `\n${pack.body}`,
  ].join("");
}

/** Internal use — admin/debug surfaces want to enumerate. */
export function listDomainPacks(): ReadonlyArray<DomainPack> {
  return Object.values(PACKS);
}
