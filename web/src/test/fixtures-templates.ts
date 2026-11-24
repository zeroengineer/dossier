import type { TemplateList } from "@/api/types"

// Fake template list for the example workspace (Acme Events).

export const templateList: TemplateList = {
  templates: [
    {
      id: "invoice",
      version: 1,
      type: "Invoice",
      title: "Invoice",
      category: "invoice",
      source: "builtin",
      description: "Tax invoice with line items and the bank account to pay into.",
      sensitivity: "Internal",
      renditions: ["pdf", "html", "md"],
      numbering: { series: "brand", required: true },
    },
    {
      id: "offer-letter",
      version: 2,
      type: "Offer Letter",
      title: "Offer letter",
      category: "letter",
      source: "workspace",
      description: "Offer of employment for Acme Events.",
      sensitivity: "Confidential",
      renditions: ["pdf", "md"],
      numbering: { series: "brand", required: false },
      inherits: true,
    },
    {
      id: "event-brief",
      version: 1,
      type: "Event Brief",
      title: "Event brief",
      category: "report",
      source: "workspace",
      description: null,
      sensitivity: "Public",
      renditions: ["pdf"],
      numbering: null,
    },
  ],
  errors: [
    {
      id: "broken-memo",
      source: "workspace",
      path: "/tmp/dossier-example/templates/broken-memo",
      code: "TEMPLATE_INVALID",
      message: "templates/broken-memo/template.json: category: required",
      details: { file: "templates/broken-memo/template.json" },
    },
  ],
}
