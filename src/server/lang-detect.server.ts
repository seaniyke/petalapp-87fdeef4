/**
 * lang-detect.server.ts — deterministic, zero-cost language hint for triage.
 *
 * The triage LLM already detects language, but a cheap pre-detector lets us:
 *   1. Inject a "the user is very likely writing in X" hint into the system
 *      prompt so the LLM commits to the right language for the reply (it
 *      sometimes defaults to English even when the user wrote in Pidgin).
 *   2. Cover African languages the LLM has weak priors on (Yoruba, Igbo,
 *      Amharic, Zulu, Xhosa).
 *
 * Strategy: script detection first (Ge'ez = Amharic, Arabic block = Arabic),
 * then stopword/marker matching for Latin-script languages. Always returns
 * a confidence — we only inject the hint when confidence >= 0.6.
 *
 * This is intentionally NOT an LLM call. Adding one would defeat the purpose.
 */

export type DetectedLang =
  | "en"
  | "pidgin"
  | "sw" // Swahili (KE/TZ/UG)
  | "yo" // Yoruba (NG)
  | "ig" // Igbo (NG)
  | "ha" // Hausa (NG/Niger)
  | "am" // Amharic (ET) — Ge'ez script
  | "zu" // Zulu (ZA)
  | "xh" // Xhosa (ZA)
  | "fr" // French (incl. West African register)
  | "ar" // Arabic (Maghrebi + MSA)
  | "pt"
  | "es"
  | "unknown";

export interface LangHint {
  lang: DetectedLang;
  confidence: number; // 0..1
  /** Human-readable label injected into the triage prompt. */
  label: string;
}

/** Stopwords / high-signal markers per language. Lowercased, word-boundary matched. */
const MARKERS: Record<Exclude<DetectedLang, "en" | "unknown" | "am" | "ar">, string[]> = {
  pidgin: [
    "abeg", "wahala", "dey", "wetin", "sabi", "comot", "abi", "oya",
    "make i", "make we", "no wahala", "small small", "chop", "no be",
  ],
  sw: [
    "habari", "asante", "karibu", "jambo", "tafadhali", "nataka",
    "ninataka", "tunahitaji", "kwa", "mimi", "wewe", "sisi", "kuwa",
    "kufanya", "tutaona", "pole", "sawa", "kazi", "mtu", "watu",
  ],
  yo: [
    "ṣe", "bawo", "fún", "ọmọ", "wọn", "ìwọ", "èmi", "ní", "kí",
    "lóòótọ́", "jọ̀wọ́", "ẹyín", "kò", "tó", "máa", "dáadáa",
  ],
  ig: [
    "kedu", "biko", "daalu", "nke", "anyị", "gị", "mụ", "ọma", "ihe",
    "ka", "mba", "ee", "achọrọ m", "chọrọ", "mee", "nye",
  ],
  ha: [
    "sannu", "nagode", "ina", "kana", "muna", "ya yi", "yaro", "abinci",
    "yaushe", "yaya", "don", "kar", "babu", "akwai", "lafiya", "barka",
  ],
  zu: [
    "sawubona", "ngiyabonga", "ngifuna", "siyabonga", "yebo", "cha",
    "ngingakwazi", "ukwenza", "umuntu", "abantu", "kanjani", "ngani",
  ],
  xh: [
    "molo", "enkosi", "ndifuna", "siyabulela", "ewe", "hayi", "ndingenza",
    "umntu", "abantu", "njani", "ngantoni", "kakuhle",
  ],
  fr: [
    "bonjour", "merci", "voudrais", "voulez", "fais", "faire", "c'est",
    "je suis", "nous sommes", "pour", "avec", "mais", "donc", "salut",
    "s'il vous plaît", "s'il te plaît", "ça va",
  ],
  pt: [
    "olá", "obrigado", "obrigada", "quero", "queria", "fazer", "para",
    "com", "mas", "também", "você", "estou",
  ],
  es: [
    "hola", "gracias", "quiero", "quisiera", "hacer", "para", "con",
    "pero", "también", "soy", "estoy", "por favor",
  ],
};

/** Unicode block tests — script alone is near-conclusive for these. */
const GEEZ = /[\u1200-\u137F]/; // Amharic, Tigrinya, Ge'ez
const ARABIC = /[\u0600-\u06FF\u0750-\u077F]/;

const LABELS: Record<DetectedLang, string> = {
  en: "English",
  pidgin: "West African Pidgin English (Nigerian/Ghanaian register)",
  sw: "Swahili (Kiswahili)",
  yo: "Yoruba",
  ig: "Igbo",
  ha: "Hausa",
  am: "Amharic",
  zu: "Zulu (isiZulu)",
  xh: "Xhosa (isiXhosa)",
  fr: "French (mirror the user's register — West African French is welcome)",
  ar: "Arabic (Maghrebi register is welcome if the user wrote in Darija)",
  pt: "Portuguese",
  es: "Spanish",
  unknown: "unknown",
};

const NO_HINT: LangHint = { lang: "unknown", confidence: 0, label: LABELS.unknown };

export function detectLanguage(rawInput: string): LangHint {
  const text = (rawInput ?? "").trim();
  if (!text || text.length < 3) return NO_HINT;

  // 1. Script-first. If meaningful characters are in Ge'ez/Arabic, that wins.
  if (GEEZ.test(text)) {
    return { lang: "am", confidence: 0.95, label: LABELS.am };
  }
  if (ARABIC.test(text)) {
    return { lang: "ar", confidence: 0.9, label: LABELS.ar };
  }

  // 2. Stopword/marker scoring for Latin-script languages.
  const lower = ` ${text.toLowerCase()} `;
  const scores = new Map<DetectedLang, number>();

  for (const [langKey, markers] of Object.entries(MARKERS)) {
    const lang = langKey as keyof typeof MARKERS;
    let hits = 0;
    for (const m of markers) {
      // word-boundary-ish: pad with non-letter context
      if (lower.includes(` ${m} `) || lower.includes(` ${m},`) || lower.includes(` ${m}.`) ||
          lower.includes(`${m} `)) {
        hits++;
        if (hits >= 4) break;
      }
    }
    if (hits > 0) scores.set(lang, hits);
  }

  if (scores.size === 0) {
    // No markers matched → assume English (the LLM is fine with English anyway).
    return { lang: "en", confidence: 0.5, label: LABELS.en };
  }

  // Pick the top scorer. Tie-break by language priority: African > European.
  const priority: DetectedLang[] = ["pidgin", "yo", "ig", "ha", "sw", "zu", "xh", "fr", "pt", "es"];
  let best: DetectedLang = "en";
  let bestScore = 0;
  for (const lang of priority) {
    const s = scores.get(lang) ?? 0;
    if (s > bestScore) {
      bestScore = s;
      best = lang;
    }
  }

  // 1 hit = weak, 2 = medium, 3+ = strong.
  const confidence = Math.min(0.95, 0.45 + bestScore * 0.18);
  return { lang: best, confidence, label: LABELS[best] };
}

/**
 * Render a system-prompt addendum that tells the triage model to reply in
 * the detected language. Returns "" when confidence is too low to commit
 * (lets the model fall back to its own detection).
 */
export function renderLanguageHint(hint: LangHint): string {
  if (hint.confidence < 0.6 || hint.lang === "unknown" || hint.lang === "en") return "";
  return (
    `\n\nLanguage detected: the user is writing in ${hint.label}. ` +
    `Set \`language\` to "${hint.lang}" and write \`reply\` in the SAME language, ` +
    `matching their register. Do not switch to English. ` +
    `Generated code stays in English (variable names, comments) — only the conversational reply mirrors their language.`
  );
}
