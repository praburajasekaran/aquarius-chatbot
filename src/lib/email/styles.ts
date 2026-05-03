// Single source of truth for email design tokens.
// All email templates and components must reference these values rather than
// inlining hex codes or sizes — a brand colour change should touch this file
// and nothing else.

import type { CSSProperties } from "react";

export const tokens = {
  colors: {
    background: "#f6f8fa",
    surface: "#ffffff",
    text: "#1a1a1a",
    textMuted: "#555555",
    textFaint: "#777777",
    border: "#e5e5e5",
    brand: "#61BBCA",
    brandAccessible: "#085a66",
    danger: "#b00020",
    dangerSurface: "#fdecea",
  },
  fonts: {
    sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  spacing: {
    container: "560px",
    padding: "32px",
  },
} as const;

export const styles = {
  body: {
    backgroundColor: tokens.colors.background,
    fontFamily: tokens.fonts.sans,
    margin: 0,
    padding: 0,
  } satisfies CSSProperties,

  container: {
    backgroundColor: tokens.colors.surface,
    margin: "40px auto",
    padding: tokens.spacing.padding,
    maxWidth: tokens.spacing.container,
    borderRadius: "8px",
  } satisfies CSSProperties,

  heading: {
    color: tokens.colors.text,
    fontSize: "24px",
    fontWeight: 600,
    margin: "0 0 16px",
  } satisfies CSSProperties,

  subheading: {
    color: tokens.colors.text,
    fontSize: "18px",
    fontWeight: 600,
    margin: "0 0 12px",
  } satisfies CSSProperties,

  paragraph: {
    color: tokens.colors.text,
    fontSize: "15px",
    lineHeight: "24px",
    margin: "0 0 16px",
  } satisfies CSSProperties,

  paragraphMuted: {
    color: tokens.colors.textMuted,
    fontSize: "13px",
    lineHeight: "20px",
    margin: "8px 0",
  } satisfies CSSProperties,

  divider: {
    borderColor: tokens.colors.border,
    margin: "32px 0 24px",
  } satisfies CSSProperties,

  link: {
    color: tokens.colors.brandAccessible,
    fontWeight: 600,
    textDecoration: "none",
  } satisfies CSSProperties,

  monoBlock: {
    color: tokens.colors.text,
    fontFamily: tokens.fonts.mono,
    fontSize: "13px",
    lineHeight: "20px",
    whiteSpace: "pre-wrap",
    margin: "0 0 10px",
  } satisfies CSSProperties,

  footer: {
    color: tokens.colors.textFaint,
    fontSize: "12px",
    lineHeight: "20px",
    margin: "0",
  } satisfies CSSProperties,

  buttonWrap: {
    margin: "24px 0",
    textAlign: "center",
  } satisfies CSSProperties,

  buttonPrimary: {
    backgroundColor: tokens.colors.brand,
    color: tokens.colors.surface,
    fontSize: "16px",
    fontWeight: 600,
    padding: "12px 24px",
    borderRadius: "6px",
    textDecoration: "none",
    display: "inline-block",
  } satisfies CSSProperties,

  buttonSecondary: {
    backgroundColor: tokens.colors.brandAccessible,
    color: tokens.colors.surface,
    fontSize: "16px",
    fontWeight: 600,
    padding: "12px 24px",
    borderRadius: "6px",
    textDecoration: "none",
    display: "inline-block",
  } satisfies CSSProperties,

  table: {
    borderCollapse: "collapse",
    width: "100%",
    margin: "16px 0",
  } satisfies CSSProperties,

  tableLabelCell: {
    padding: "8px",
    border: `1px solid ${tokens.colors.border}`,
    fontWeight: 600,
    width: "35%",
    verticalAlign: "top",
  } satisfies CSSProperties,

  tableValueCell: {
    padding: "8px",
    border: `1px solid ${tokens.colors.border}`,
    verticalAlign: "top",
  } satisfies CSSProperties,

  banner: {
    backgroundColor: tokens.colors.dangerSurface,
    color: tokens.colors.danger,
    padding: "12px 16px",
    borderRadius: "6px",
    fontSize: "14px",
    fontWeight: 600,
    margin: "0 0 16px",
  } satisfies CSSProperties,
} as const;
