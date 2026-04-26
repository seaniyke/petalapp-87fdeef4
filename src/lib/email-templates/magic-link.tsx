import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from '@react-email/components'
import { styles } from './_brand'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
}: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your sign-in link for {siteName}</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Text style={styles.brand}>🌸 {siteName}</Text>
        <Heading style={styles.h1}>Sign in to {siteName}</Heading>
        <Text style={styles.text}>
          Click the button below to sign in. This link will expire shortly, so
          use it soon.
        </Text>
        <Button style={styles.button} href={confirmationUrl}>
          Sign in
        </Button>
        <Text style={styles.footer}>
          Didn't request this link? You can safely ignore this email — your
          account is still secure.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail
