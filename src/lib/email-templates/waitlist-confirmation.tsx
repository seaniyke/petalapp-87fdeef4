/**
 * Sent once, right after someone joins the Petal waitlist.
 */
import * as React from "react";
import { Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";
import { PetalEmailLayout, SITE_URL, text, muted } from "./_layout";

interface Props {
  name?: string;
}

function WaitlistConfirmation({ name }: Props) {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return (
    <PetalEmailLayout
      preview="You're on the Petal waitlist 🌸"
      heading="You're on the list"
      cta={{ label: "See what Petal builds", href: SITE_URL }}
    >
      <Text style={text}>
        {first ? `Hey ${first} —` : "Hey —"} thanks for joining the Petal waitlist.
      </Text>
      <Text style={text}>
        Petal turns a sentence into a real app: web, mobile, backends and Chrome
        extensions. We're letting people in gradually so every build stays fast.
      </Text>
      <Text style={muted}>
        We'll email you the moment your spot opens. No spam, ever.
      </Text>
    </PetalEmailLayout>
  );
}

export const template = {
  component: WaitlistConfirmation,
  subject: "You're on the Petal waitlist 🌸",
  displayName: "Waitlist confirmation",
  previewData: { name: "Ada Lovelace" },
} satisfies TemplateEntry;
