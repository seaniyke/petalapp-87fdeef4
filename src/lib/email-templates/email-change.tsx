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

interface EmailChangeEmailProps {
  siteName: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({
  siteName,
  email,
  newEmail,
  confirmationUrl,
}: EmailChangeEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your new email for {siteName}</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Text style={styles.brand}>🌸 {siteName}</Text>
        <Heading style={styles.h1}>Confirm your new email</Heading>
        <Text style={styles.text}>
          You requested to change the email on your {siteName} account from{' '}
          <Link href={`mailto:${email}`} style={styles.link}>
            {email}
          </Link>{' '}
          to{' '}
          <Link href={`mailto:${newEmail}`} style={styles.link}>
            {newEmail}
          </Link>
          .
        </Text>
        <Text style={styles.text}>
          Confirm the change by clicking the button below.
        </Text>
        <Button style={styles.button} href={confirmationUrl}>
          Confirm email change
        </Button>
        <Text style={styles.footer}>
          Didn't request this change? Please secure your account immediately by
          resetting your password.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default EmailChangeEmail
