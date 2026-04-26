// Shared brand tokens for Petal auth emails. Email body background is white
// per Lovable email guidelines, even though the app uses a warm off-white.
// Colors are sRGB hex (not oklch) for maximum email-client compatibility.

export const brand = {
  siteName: 'Petal',
  bodyBg: '#ffffff',
  cardBg: '#fffaf6',
  border: '#f1e6db',
  text: '#3a2a20',
  textMuted: '#8a7568',
  textFooter: '#a8978a',
  heading: '#2a1c14',
  primary: '#e2674d',
  primaryHover: '#d05a42',
  link: '#c95437',
  fontDisplay:
    '"Fraunces", "DM Serif Display", Georgia, "Times New Roman", serif',
  fontBody:
    '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
} as const;

export const styles = {
  main: {
    backgroundColor: brand.bodyBg,
    fontFamily: brand.fontBody,
    margin: 0,
    padding: '40px 0',
  },
  container: {
    backgroundColor: brand.cardBg,
    border: `1px solid ${brand.border}`,
    borderRadius: '16px',
    padding: '40px 32px',
    maxWidth: '480px',
    margin: '0 auto',
  },
  brand: {
    fontFamily: brand.fontDisplay,
    fontSize: '20px',
    fontWeight: 600 as const,
    color: brand.heading,
    letterSpacing: '-0.01em',
    margin: '0 0 28px',
  },
  h1: {
    fontFamily: brand.fontDisplay,
    fontSize: '26px',
    fontWeight: 600 as const,
    color: brand.heading,
    letterSpacing: '-0.02em',
    lineHeight: '1.2',
    margin: '0 0 16px',
  },
  text: {
    fontSize: '15px',
    color: brand.text,
    lineHeight: '1.6',
    margin: '0 0 20px',
  },
  link: { color: brand.link, textDecoration: 'underline' },
  button: {
    backgroundColor: brand.primary,
    color: '#ffffff',
    fontSize: '15px',
    fontWeight: 500 as const,
    borderRadius: '12px',
    padding: '13px 24px',
    textDecoration: 'none',
    display: 'inline-block',
    margin: '8px 0 24px',
  },
  code: {
    fontFamily: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
    fontSize: '28px',
    fontWeight: 600 as const,
    color: brand.heading,
    letterSpacing: '0.2em',
    backgroundColor: '#ffffff',
    border: `1px solid ${brand.border}`,
    borderRadius: '12px',
    padding: '18px 24px',
    textAlign: 'center' as const,
    margin: '0 0 28px',
  },
  footer: {
    fontSize: '13px',
    color: brand.textFooter,
    lineHeight: '1.5',
    margin: '24px 0 0',
    paddingTop: '20px',
    borderTop: `1px solid ${brand.border}`,
  },
} as const;
