import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from '@react-email/components'
import { styles } from './_brand'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email to start building with {siteName}</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Text style={styles.brand}>🌸 {siteName}</Text>
        <Heading style={styles.h1}>Confirm your email</Heading>
        <Text style={styles.text}>
          Welcome to{' '}
          <Link href={siteUrl} style={styles.link}>
            {siteName}
          </Link>
          ! We're glad you're here.
        </Text>
        <Text style={styles.text}>
          Please confirm{' '}
          <Link href={`mailto:${recipient}`} style={styles.link}>
            {recipient}
          </Link>{' '}
          to activate your account and start building.
        </Text>
        <Button style={styles.button} href={confirmationUrl}>
          Verify email
        </Button>
        <Text style={styles.footer}>
          Didn't sign up? You can safely ignore this email — no account will be
          created.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default SignupEmail
