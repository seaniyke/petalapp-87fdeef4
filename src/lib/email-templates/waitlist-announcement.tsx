/**
 * Broadcast to waitlist members when we open access (or ship something big).
 * Subject / heading / body / CTA all come from the admin composer.
 */
import * as React from "react";
import { Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";
import { PetalEmailLayout, SITE_URL, text, muted } from "./_layout";

interface Props {
  name?: string;
  heading?: string;
  body?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footnote?: string;
}

function WaitlistAnnouncement({
  name,
  heading,
  body,
  ctaLabel,
  ctaUrl,
  footnote,
}: Props) {
  const first = (name ?? "").trim().split(/\s+/)[0];
  const paragraphs = (body ?? "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <PetalEmailLayout
      preview={heading ?? "News from Petal"}
      heading={heading ?? "News from Petal"}
      cta={
        ctaUrl
          ? { label: ctaLabel || "Open Petal", href: ctaUrl }
          : { label: "Open Petal", href: SITE_URL }
      }
      footnote={footnote}
    >
      <Text style={text}>{first ? `Hey ${first},` : "Hey there,"}</Text>
      {paragraphs.length > 0 ? (
        paragraphs.map((p, i) => (
          <Text key={i} style={text}>
            {p}
          </Text>
        ))
      ) : (
        <Text style={muted}>We've got news — head over to Petal to take a look.</Text>
      )}
    </PetalEmailLayout>
  );
}

export const template = {
  component: WaitlistAnnouncement,
  subject: (data: Record<string, any>) =>
    (typeof data?.subject === "string" && data.subject.trim()) || "News from Petal",
  displayName: "Waitlist announcement",
  previewData: {
    name: "Ada Lovelace",
    subject: "Petal is open — your spot is ready",
    heading: "Your spot is ready",
    body: "We're opening Petal to the waitlist today.\n\nSign in with this email and start building.",
    ctaLabel: "Start building",
    ctaUrl: "https://buildwithpetal.com/auth?mode=signup",
  },
} satisfies TemplateEntry;
