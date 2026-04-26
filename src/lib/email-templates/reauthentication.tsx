import * as React from 'react'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from '@react-email/components'
import { styles, brand } from './_brand'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your {brand.siteName} verification code</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Text style={styles.brand}>🌸 {brand.siteName}</Text>
        <Heading style={styles.h1}>Confirm it's you</Heading>
        <Text style={styles.text}>
          Use the code below to confirm your identity and continue.
        </Text>
        <Text style={styles.code}>{token}</Text>
        <Text style={styles.footer}>
          This code expires shortly. Didn't request this? You can safely ignore
          this email — your account is still secure.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail
