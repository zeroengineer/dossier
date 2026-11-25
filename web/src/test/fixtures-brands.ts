import type { BrandAssets, BrandDetail, BrandFile, BrandList, ResolvedBrand } from "@/api/types"

// Fake data from the example workspace only (Acme Events, example.com).

const PALETTE = {
  ink: "#1a1a1a", body: "#333333", label: "#555555", muted: "#666666", faint: "#888888", subtle: "#999999",
  rule: "#e8e8e8", ruleStrong: "#d0d0d0", ruleFaint: "#f0f0f0",
  fill: "#fbfbfb", fillAlt: "#f8f8f8", fillTotal: "#f1f1f1", fillPanel: "#f9f9f9",
  section: "#606f7b", accent: "#1a1a1a", white: "#ffffff",
}

const FONTS = {
  regular: "builtin:Manrope-Regular", medium: "builtin:Manrope-Medium", semibold: "builtin:Manrope-SemiBold",
  bold: "builtin:Manrope-Bold", extrabold: "builtin:Manrope-ExtraBold", light: "builtin:Manrope-Light",
  extralight: "builtin:Manrope-ExtraLight",
}

/** brand.json of the root brand (a trimmed copy of workspace.example/brands/acme). */
export const acmeFile: BrandFile = {
  id: "acme",
  legalName: "Acme Events Private Limited",
  shortName: "Acme Events",
  registrations: [{ label: "CIN", value: "U00000XX2000PTC000000" }, { label: "PAN", value: "AAAAA0000A" }],
  addresses: {
    business: ["Unit 000, Example Business Park, 1 Sample Road", "Example City, Example State 000000, India"],
    registered: ["No. 0, Placeholder Lane", "Example City, Example State 000000, India"],
  },
  contacts: {
    default: { email: "hello@example.com", phone: "+00 00000 00000", website: "www.example.com" },
    hr: { email: "hr@example.com" },
  },
  bankAccounts: [{ accountName: "Acme Events Private Limited", bankName: "Example Bank", accountNumber: "000000000000", ifsc: "EXMP0000000" }],
  letterhead: { lines: ["CIN: U00000XX2000PTC000000", "Email: {contact.email} | {contact.website}"] },
  footer: { left: "{contact.email}", center: "{strings.confidential}", right: "Page {page} of {pages}" },
  palette: { accent: "#e5484d" },
  fonts: { regular: "builtin:Manrope-Regular" },
  assets: { logo: "assets/logo.png", seal: "assets/seal.png" },
  signatories: [
    { id: "ops", name: "Alex Example", title: "Chief Operating Officer", signature: "assets/sign-ops.png", email: "alex@example.com" },
    { id: "md", name: "Sam Sample", title: "Managing Director" },
  ],
  defaultSignatory: { invoice: "ops", letter: "md" },
  projectContact: "ops",
  strings: { confidential: "Confidential", thankYou: "THANK YOU FOR YOUR BUSINESS" },
  tax: {
    modes: [
      { id: "none", label: "No tax", rates: [] },
      { id: "igst", label: "IGST", rates: [{ label: "IGST @ 18%", rate: 0.18 }] },
    ],
    defaultMode: "igst",
    defaultHsn: "998596",
  },
  series: { invoice: "invoice-main" },
  templateParams: { invoice: { showHsn: true } },
}

export const acmeResolved: ResolvedBrand = {
  id: "acme",
  legalName: "Acme Events Private Limited",
  shortName: "Acme Events",
  registrations: [{ label: "CIN", value: "U00000XX2000PTC000000" }, { label: "PAN", value: "AAAAA0000A" }],
  addresses: {
    business: ["Unit 000, Example Business Park, 1 Sample Road", "Example City, Example State 000000, India"],
    registered: ["No. 0, Placeholder Lane", "Example City, Example State 000000, India"],
  },
  contacts: {
    default: { email: "hello@example.com", phone: "+00 00000 00000", website: "www.example.com" },
    hr: { email: "hr@example.com" },
  },
  bankAccounts: [{ accountName: "Acme Events Private Limited", bankName: "Example Bank", accountNumber: "000000000000", ifsc: "EXMP0000000" }],
  letterhead: { lines: ["CIN: U00000XX2000PTC000000", "Email: {contact.email} | {contact.website}"] },
  footer: { left: "{contact.email}", center: "{strings.confidential}", right: "Page {page} of {pages}" },
  palette: { ...PALETTE, accent: "#e5484d" },
  fonts: FONTS,
  assets: { logo: "assets/logo.png", seal: "assets/seal.png" },
  signatories: [
    { id: "ops", name: "Alex Example", title: "Chief Operating Officer", signature: "assets/sign-ops.png", email: "alex@example.com" },
    { id: "md", name: "Sam Sample", title: "Managing Director" },
  ],
  defaultSignatory: { invoice: "ops", letter: "md" },
  projectContact: "ops",
  strings: { confidential: "Confidential", thankYou: "THANK YOU FOR YOUR BUSINESS" },
  tax: {
    modes: [
      { id: "none", label: "No tax", rates: [] },
      { id: "igst", label: "IGST", rates: [{ label: "IGST @ 18%", rate: 0.18 }] },
    ],
    defaultMode: "igst",
    defaultHsn: "998596",
  },
  series: { invoice: "invoice-main" },
  templateParams: { invoice: { showHsn: true } },
}

/** An inheriting brand: only its overrides are stored. */
export const studioFile: BrandFile = {
  id: "acme-studio",
  inheritsFrom: "acme",
  legalName: "Acme Studio LLP",
  shortName: "Acme Studio",
  contacts: { default: { email: "studio@example.com" } },
  strings: { thankYou: "THANKS FROM THE STUDIO" },
}

export const studioResolved: ResolvedBrand = {
  ...acmeResolved,
  id: "acme-studio",
  inheritsFrom: "acme",
  legalName: "Acme Studio LLP",
  shortName: "Acme Studio",
  contacts: { default: { email: "studio@example.com", phone: "+00 00000 00000", website: "www.example.com" }, hr: { email: "hr@example.com" } },
  strings: { confidential: "Confidential", thankYou: "THANKS FROM THE STUDIO" },
}

export const brandDetails: Record<string, BrandDetail> = {
  acme: { id: "acme", file: acmeFile, resolved: acmeResolved, configHash: "aaaaaaaaaaaa5a1b2c3d4e5f1111" },
  "acme-studio": { id: "acme-studio", file: studioFile, resolved: studioResolved, configHash: "bbbbbbbbbbbb6a7b8c9d0e1f2222" },
}

export const brandList: BrandList = {
  brands: [
    { id: "acme", legalName: "Acme Events Private Limited" },
    { id: "acme-studio", legalName: "Acme Studio LLP", inheritsFrom: "acme" },
  ],
}

export const acmeAssets: BrandAssets = {
  assets: [
    { key: "assets.logo", path: "assets/logo.png", source: "configured", present: true, version: "0123456789ab", url: "/assets/brands/acme/logo?v=0123456789ab" },
    { key: "assets.seal", path: "assets/seal.png", source: "placeholder", present: false, version: "fedcba987654", url: "/assets/brands/acme/seal?v=fedcba987654" },
    { key: "assets.watermark", path: null, source: null, present: false, version: null, url: "/assets/brands/acme/watermark" },
    { key: "signature:ops", path: "assets/sign-ops.png", source: "configured", present: true, version: "5a1b2c3d4e5f", url: "/assets/brands/acme/signatures/ops?v=5a1b2c3d4e5f" },
    { key: "signature-large:ops", path: "assets/sign-ops.png", source: "fallback", present: false, version: "5a1b2c3d4e5f", url: "/assets/brands/acme/signatures-large/ops?v=5a1b2c3d4e5f" },
    { key: "font:regular", path: "builtin:Manrope-Regular", source: "configured", present: true, version: "6a7b8c9d0e1f", url: "/assets/brands/acme/fonts/regular?v=6a7b8c9d0e1f" },
  ],
}

