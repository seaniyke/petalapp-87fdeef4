/**
 * User-facing copy for build failures. A valid request that fails to build is
 * a build failure — never imply the prompt was the cause.
 */
export const EMPTY_HOME_BUILD_FAILURE_MESSAGE =
  "The build didn't finish: the home page came back empty, so I rolled it back instead of shipping a placeholder. Nothing was changed and no credits were charged. Your request was fine — try building again.";

/** Phrases that blame the user's prompt for a build failure. */
export const PROMPT_BLAME_PATTERN =
  /send (?:your|the) prompt again|more detail|rephrase|be more specific|rewrite (?:your|the) (?:prompt|request)/i;
