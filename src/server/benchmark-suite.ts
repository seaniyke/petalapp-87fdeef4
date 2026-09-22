/**
 * W5 — the fixed benchmark suite.
 *
 * Fifteen prompts that never change. Their whole value is that they are
 * frozen: a score is only comparable to yesterday's score if the question was
 * identical. Do NOT reword these to make Kimble look better — add a new case
 * with a new id instead, and let the old one keep its history.
 *
 * Each case carries its own PRD-style acceptance criteria. Those criteria are
 * what "spec adherence" is measured against, and the same list is what
 * "regression safety" diffs against the previous run: a criterion that passed
 * last night and fails tonight is a regression, regardless of the total score.
 */

export interface BenchmarkCriterion {
  /** Stable id — regression tracking joins on this, never on the text. */
  id: string;
  /** One observable, checkable statement about the finished app. */
  text: string;
}

export interface BenchmarkCase {
  id: string;
  title: string;
  prompt: string;
  /** Rough shape, used only for reporting/grouping. */
  kind: "landing" | "tool" | "dashboard" | "multi-page" | "form";
  criteria: BenchmarkCriterion[];
}

export const BENCHMARK_SUITE: BenchmarkCase[] = [
  {
    id: "pregnancy-due-date",
    title: "Pregnancy due date calculator",
    kind: "tool",
    prompt:
      "Build a pregnancy due date calculator. The user enters the first day of their last period and sees their estimated due date, current week of pregnancy, and trimester. Include a short explanation of how the estimate is calculated.",
    criteria: [
      { id: "input-lmp", text: "There is a date input for the last menstrual period." },
      { id: "computes-due-date", text: "Submitting a date shows an estimated due date computed from it." },
      { id: "shows-week", text: "The result includes the current week of pregnancy and the trimester." },
      { id: "explains-method", text: "The page explains how the estimate is calculated." },
    ],
  },
  {
    id: "expense-splitter",
    title: "Group expense splitter",
    kind: "tool",
    prompt:
      "Build a group expense splitter. Users add people and expenses, and the app shows who owes whom and how much, with a running total per person.",
    criteria: [
      { id: "add-person", text: "Users can add a person to the group." },
      { id: "add-expense", text: "Users can add an expense with an amount and a payer." },
      { id: "settlement", text: "The app shows who owes whom, derived from the entered expenses." },
      { id: "per-person-total", text: "Each person has a visible running total." },
    ],
  },
  {
    id: "saas-landing",
    title: "SaaS landing page",
    kind: "landing",
    prompt:
      "Build a landing page for a project management SaaS called Lanewise. Include a nav, hero, social proof, features, how it works, pricing with three tiers, testimonials, FAQ, final CTA and footer.",
    criteria: [
      { id: "nav", text: "There is a top navigation bar with the product name and a call to action." },
      { id: "hero", text: "The hero states what the product does and is fully visible, not clipped." },
      { id: "pricing-3", text: "A pricing section shows exactly three tiers." },
      { id: "faq", text: "There is an FAQ section with expandable questions." },
      { id: "footer", text: "There is a footer with links grouped into columns." },
    ],
  },
  {
    id: "habit-tracker",
    title: "Weekly habit tracker",
    kind: "dashboard",
    prompt:
      "Build a weekly habit tracker. Users create habits and check them off per day for the current week, and see a completion percentage for each habit and for the week overall.",
    criteria: [
      { id: "create-habit", text: "Users can create a new habit." },
      { id: "check-day", text: "Each habit has a checkbox per day of the week that toggles." },
      { id: "per-habit-pct", text: "Each habit shows its completion percentage." },
      { id: "week-pct", text: "The week has an overall completion percentage." },
    ],
  },
  {
    id: "recipe-multipage",
    title: "Multi-page recipe site",
    kind: "multi-page",
    prompt:
      "Build a recipe site with a home page listing recipes, a recipe detail page, a favourites page and an about page. The nav links must all work and the detail page must show ingredients and steps.",
    criteria: [
      { id: "routes-exist", text: "Home, recipe detail, favourites and about are separate routes." },
      { id: "nav-works", text: "Every nav link navigates without a full page reload or a 404." },
      { id: "detail-content", text: "A recipe detail page lists ingredients and numbered steps." },
      { id: "favourite-toggle", text: "A recipe can be added to favourites and appears on the favourites page." },
    ],
  },
  {
    id: "invoice-generator",
    title: "Invoice generator",
    kind: "form",
    prompt:
      "Build an invoice generator. The user fills in sender, client, line items with quantity and rate, tax rate, and sees a live invoice preview with subtotal, tax and total.",
    criteria: [
      { id: "line-items", text: "Users can add and remove line items with quantity and rate." },
      { id: "live-preview", text: "An invoice preview updates as the form is filled in." },
      { id: "totals", text: "Subtotal, tax and total are calculated correctly from the line items." },
      { id: "no-reload", text: "No control submits the page or causes a reload." },
    ],
  },
  {
    id: "job-board",
    title: "Job board with filters",
    kind: "dashboard",
    prompt:
      "Build a job board. Show a list of jobs with title, company, location and tags, and let users filter by search text, location and remote-only.",
    criteria: [
      { id: "job-list", text: "A list of jobs renders with title, company and location." },
      { id: "search-filter", text: "Typing in the search box filters the visible jobs." },
      { id: "remote-toggle", text: "A remote-only toggle filters the list." },
      { id: "empty-state", text: "When no jobs match, an empty state is shown instead of a blank area." },
    ],
  },
  {
    id: "portfolio",
    title: "Designer portfolio",
    kind: "landing",
    prompt:
      "Build a portfolio site for a product designer. Include a distinctive hero, a project grid with case study cards, an about section, and a contact form.",
    criteria: [
      { id: "hero-brand", text: "The hero shows a real brand/name and a logo mark, not a placeholder." },
      { id: "project-grid", text: "A grid of project cards renders with images or illustrated placeholders." },
      { id: "contact-form", text: "The contact form validates input and shows a success state on submit." },
      { id: "mobile-ok", text: "At 390px wide, nothing overflows horizontally and content is not cramped." },
    ],
  },
  {
    id: "quiz-app",
    title: "Multiple choice quiz",
    kind: "tool",
    prompt:
      "Build a multiple choice quiz with ten questions, one question per screen, a progress indicator, and a results screen with the score and a retry button.",
    criteria: [
      { id: "one-per-screen", text: "Exactly one question is shown at a time." },
      { id: "progress", text: "A progress indicator reflects the current question number." },
      { id: "score", text: "The results screen shows a score out of ten." },
      { id: "retry", text: "A retry button restarts the quiz from the first question." },
    ],
  },
  {
    id: "crm-dashboard",
    title: "Sales CRM dashboard",
    kind: "dashboard",
    prompt:
      "Build a sales CRM dashboard with KPI cards, a revenue chart, a deals table with status badges, and a side panel that opens when a deal is clicked.",
    criteria: [
      { id: "kpis", text: "KPI cards render with numeric values." },
      { id: "chart", text: "A chart renders with visible data, not an empty box." },
      { id: "table", text: "A deals table renders rows with status badges." },
      { id: "detail-panel", text: "Clicking a deal opens a panel or dialog with that deal's details." },
    ],
  },
  {
    id: "booking-flow",
    title: "Appointment booking flow",
    kind: "form",
    prompt:
      "Build an appointment booking flow: pick a service, pick a date and time slot, enter contact details, and see a confirmation summary. Show a step indicator throughout.",
    criteria: [
      { id: "steps", text: "A step indicator shows the current step of the flow." },
      { id: "slot-pick", text: "Selecting a date reveals selectable time slots." },
      { id: "validation", text: "Contact details are validated before the final step." },
      { id: "confirmation", text: "A confirmation summary repeats the chosen service, date and time." },
    ],
  },
  {
    id: "unit-converter",
    title: "Unit converter",
    kind: "tool",
    prompt:
      "Build a unit converter supporting length, weight and temperature. Converting updates instantly as the user types, and units can be swapped with one click.",
    criteria: [
      { id: "categories", text: "Length, weight and temperature are all selectable." },
      { id: "live-convert", text: "The output updates as the user types, without pressing a button." },
      { id: "swap", text: "A swap control reverses the from/to units." },
      { id: "correct-math", text: "A known conversion (e.g. 100C to F) produces the correct value." },
    ],
  },
  {
    id: "blog-multipage",
    title: "Blog with post pages",
    kind: "multi-page",
    prompt:
      "Build a blog with an index page of posts, individual post pages, a tag filter, and an author page. Every internal link must work.",
    criteria: [
      { id: "index", text: "The index lists posts with title, excerpt and date." },
      { id: "post-route", text: "Clicking a post opens its own route with the full body." },
      { id: "tags", text: "Selecting a tag filters the index to posts with that tag." },
      { id: "links-resolve", text: "No internal link leads to a 404 or a blank screen." },
    ],
  },
  {
    id: "budget-tracker",
    title: "Monthly budget tracker",
    kind: "dashboard",
    prompt:
      "Build a monthly budget tracker with income, categorised expenses, a remaining-budget figure, and a breakdown chart by category.",
    criteria: [
      { id: "income", text: "Users can set a monthly income figure." },
      { id: "add-expense", text: "Users can add an expense with a category and amount." },
      { id: "remaining", text: "Remaining budget updates as expenses are added." },
      { id: "breakdown", text: "A chart or bar breakdown by category reflects the entered expenses." },
    ],
  },
  {
    id: "restaurant-site",
    title: "Restaurant site with menu",
    kind: "multi-page",
    prompt:
      "Build a restaurant website with a home page, a menu page grouped by course, a reservations page with a form, and a location page with opening hours.",
    criteria: [
      { id: "four-routes", text: "Home, menu, reservations and location are separate working routes." },
      { id: "menu-groups", text: "The menu is grouped by course with prices." },
      { id: "reservation-form", text: "The reservation form validates and shows a confirmation state." },
      { id: "hours", text: "Opening hours are listed on the location page." },
    ],
  },
];

export function findBenchmarkCase(id: string): BenchmarkCase | undefined {
  return BENCHMARK_SUITE.find((c) => c.id === id);
}
