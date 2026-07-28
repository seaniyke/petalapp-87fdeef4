/**
 * Sent when a waitlist member's referrals hit a milestone.
 */
import * as React from "react";
import { Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";
import { PetalEmailLayout, SITE_URL, text, muted } from "./_layout";

interface Props {
  name?: string;
  count?: number;
  referralCode?: string;
}

function WaitlistReferralMilestone({ name, count = 1, referralCode }: Props) {
  const first = (name ?? "").trim().split(/\s+/)[0];
  const link = referralCode ? `${SITE_URL}/r/${referralCode}` : SITE_URL;
  return (
    <PetalEmailLayout
      preview={`${count} friend${count === 1 ? "" : "s"} joined because of you 🌸`}
      heading={count === 1 ? "Your first invite landed" : `${count} friends in — nice`}
      cta={{ label: "Grab your link", href: link }}
    >
      <Text style={text}>
        {first ? `Hey ${first} —` : "Hey —"} {count === 1 ? "someone" : `${count} people`} joined
        the Petal waitlist from your link. You jumped {count * 15} spots.
      </Text>
      <Text style={text}>
        Three friends and you skip the line completely — instant access, plus credits
        for every friend who actually starts building.
      </Text>
      <Text style={muted}>Your link: {link}</Text>
    </PetalEmailLayout>
  );
}

export const template = {
  component: WaitlistReferralMilestone,
  subject: (data: Record<string, any>) =>
    Number(data?.count) === 1
      ? "Your first invite just landed 🌸"
      : `${Number(data?.count) || 0} friends joined from your link 🌸`,
  displayName: "Waitlist referral milestone",
  previewData: { name: "Ada Lovelace", count: 3, referralCode: "ada7fq" },
} satisfies TemplateEntry;
