import type { Me, Meta } from "@/api/types"

// Fake data from the example workspace only (Acme Events, example.com).

export const me: Me = {
  user: { id: "demo", clearance: "Confidential" },
  workspace: {
    name: "Example Workspace",
    defaultBrand: "acme",
    locale: {
      currencySymbol: "₹",
      currencyCode: "INR",
      numberLocale: "en-IN",
      dateFormats: { short: "DD/MM/YYYY", long: "D MMMM YYYY", us: "MMMM D, YYYY" },
    },
    home: "/tmp/dossier-example",
    dataDir: "/tmp/dossier-example/data",
  },
  brands: [
    { id: "acme", legalName: "Acme Events Private Limited", shortName: "Acme Events" },
    { id: "acme-studio", legalName: "Acme Studio LLP", shortName: "Acme Studio" },
  ],
  version: "1.0.0",
}

export const meta: Meta = {
  statuses: ["Draft", "Sent", "Signed", "Paid", "Superseded"],
  transitions: {
    Draft: ["Sent", "Signed", "Superseded"],
    Sent: ["Signed", "Paid", "Superseded"],
    Signed: ["Paid", "Superseded"],
    Paid: ["Superseded"],
    Superseded: [],
  },
  sensitivityLevels: ["Public", "Internal", "Confidential", "Restricted"],
  clearances: ["Public", "Internal", "Confidential", "Restricted"],
  relationTypes: ["based_on", "pays", "settles", "adjusts", "follows", "generated_from", "supersedes", "rendition_of"],
  entityRoles: ["party", "signatory", "named", "contact", "issuer"],
  partyTypes: ["Company", "GroupEntity", "Person", "Client", "Vendor", "Product"],
  entityKinds: ["company", "group_entity", "person", "client", "vendor", "product", "business_line", "engagement", "financial_year"],
  entityRelationRoles: ["employed_by", "director_of"],
  seriesScopes: ["global", "brand", "brand+year", "brand+year+client", "brand+year+code"],
  fontWeights: ["regular", "medium", "semibold", "bold", "extrabold", "light", "extralight"],
  builtinFonts: ["builtin:Manrope-Regular"],
  documentTypes: ["invoice", "letter"],
  hierarchy: { topLevel: ["01 Company"], topKeys: ["company"], leaves: { company: ["Legal and Registration"] }, defaultLeaf: "Other" },
  templateCategories: ["invoice", "letter", "statement", "agreement", "proposal", "report", "resolution"],
  fieldTypes: ["string", "text", "date", "money", "number", "enum", "entity", "array", "object", "boolean"],
  limits: { assetMaxBytes: 5242880, uploadMaxBytes: 52428800 },
}
