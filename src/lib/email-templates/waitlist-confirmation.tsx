/**
 * Sent once, right after someone joins the Petal waitlist.
 * Doubles as the hand-off into their referral status page.
 */
import * as React from "react";
import { Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";
import { PetalEmailLayout, SITE_URL, text, muted } from "./_layout";

interface Props {
  name?: string;
  referralCode?: string;
  statusToken?: string;
}

function WaitlistConfirmation({ name, referralCode, statusToken }: Props) {
  const first = (name ?? "").trim().split(/\s+/)[0];
  const statusUrl = statusToken
    ? `${SITE_URL}/waitlist?t=${encodeURIComponent(statusToken)}`
    : SITE_URL;
  const link = referralCode ? `${SITE_URL}/r/${referralCode}` : null;

  return (
    <PetalEmailLayout
      preview="You're on the Petal waitlist 🌸"
      heading="You're on the list"
      cta={{ label: "See your spot + invite link", href: statusUrl }}
    >
      <Text style={text}>
        {first ? `Hey ${first} —` : "Hey —"} thanks for joining the Petal waitlist.
      </Text>
      <Text style={text}>
        Petal turns a sentence into a real app: web, mobile, backends and Chrome
        extensions. We're letting people in gradually so every build stays fast.
      </Text>
      <Text style={text}>
        Want in sooner? Every friend who joins with your link moves you up 15 spots —
        three friends and you skip the line entirely.
      </Text>
      {link ? <Text style={muted}>Your link: {link}</Text> : null}
      <Text style={muted}>No spam, ever.</Text>
    </PetalEmailLayout>
  );
}

export const template = {
  component: WaitlistConfirmation,
  subject: "You're on the Petal waitlist 🌸",
  displayName: "Waitlist confirmation",
  previewData: { name: "Ada Lovelace", referralCode: "ada7fq", statusToken: "demo-token" },
} satisfies TemplateEntry;
