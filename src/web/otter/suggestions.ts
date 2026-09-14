import type { OtterSection } from "../../shared/types";

export const GLOBAL_SUGGESTIONS: Record<OtterSection, string[]> = {
  overview: [
    "Explain this scan simply",
    "What should I investigate first?",
    "Is anything critical?",
    "How complete was this analysis?",
  ],
  risks: [
    "Why is this ranked first?",
    "Which risks affect runtime code?",
    "Which dependency has the largest ripple?",
  ],
  applications: [
    "Why is this application exposed?",
    "What should I investigate here?",
    "Which vulnerable packages affect this application?",
  ],
  dependencies: [
    "Why is this package here?",
    "Is this direct or indirect?",
    "Which applications use it?",
    "Where can I see unresolved dependencies?",
  ],
  vulnerabilities: [
    "Which vulnerability should I look at first?",
    "Is exploitation known for any of these?",
    "Which applications are affected most?",
  ],
  graph: [
    "Explain this path",
    "What does this ripple mean?",
    "Why does this dependency reach these applications?",
  ],
  coverage: [
    "Why couldn't these packages be fully checked?",
    "Can I trust this scan?",
    "What information is missing?",
  ],
  evidence: [
    "Where did this severity come from?",
    "What source confirms this finding?",
    "Is exploitation known?",
  ],
};

export const APPLICATION_SUGGESTIONS = [
  "Why is this application exposed?",
  "What should I investigate here?",
  "Which vulnerable packages affect this application?",
];

export const FOCUSED_SUGGESTIONS = [
  "Why is this vulnerability dangerous?",
  "Explain it simply",
  "How did this package enter my application?",
  "Which applications are affected?",
  "Is it direct or indirect?",
  "Is it used at runtime?",
  "Why is its priority high?",
  "What version should I upgrade to?",
  "Where did this CVSS score come from?",
  "What evidence says it is exploited?",
];
