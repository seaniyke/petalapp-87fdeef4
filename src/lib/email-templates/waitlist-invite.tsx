/**
 * Sent when an admin individually approves a waitlist member.
 * Their spot is open — this is the "come in and sign in" email.
 */
import * as React from "react";
import { Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";
import { PetalEmailLayout, SITE_URL, text, muted } from "./_layout";

interface Props {
  name?: string;
  email?: string;
  signInUrl?: string;
}

function WaitlistInvite({ name, email, signInUrl }: Props) {
  const first = (name ?? "").trim().split(/\s+/)[0];
  const href = signInUrl || `${SITE_URL}/auth?mode=signup`;
  return (
    <PetalEmailLayout
      preview="Your Petal invite is here 🌸"
      heading="You're in."
      cta={{ label: "Sign in to Petal", href }}
    >
      <Text style={text}>
        {first ? `Hey ${first} —` : "Hey —"} your spot on the Petal waitlist just
        opened. You can sign in and start building right now.
      </Text>
      <Text style={text}>
        Describe what you want in a sentence and Petal ships it: web apps, mobile
        apps, backends and Chrome extensions.
      </Text>
      <Text style={muted}>
        Use{email ? ` ${email}` : " this email address"} when you sign in — that's
        the address on your invite.
      </Text>
    </PetalEmailLayout>
  );
}

export const template = {
  component: WaitlistInvite,
  subject: "Your Petal invite is here 🌸",
  displayName: "Waitlist invite",
  previewData: { name: "Ada Lovelace", email: "ada@example.com" },
} satisfies TemplateEntry;
