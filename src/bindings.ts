import { z } from "zod";
export const Variant = z.enum(["classic", "cards"]);
export type Variant = z.infer<typeof Variant>;
// Reviewed code, never supplied by an artifact or API caller.
const cardNames: Record<string, string> = {
  "Member number": "Member ID",
  "Member search": "Find member",
  "Member details": "Member profile",
  "Balance summary": "Savings overview",
  "Savings balance": "Available savings",
  Search: "Look up",
};
export function physicalName(name: string, variant: Variant) {
  return variant === "cards" ? (cardNames[name] ?? name) : name;
}
export function renderVariant(html: string, variant: Variant) {
  if (variant === "cards") {
    html = html
      .replace(/<table[^>]*>/g, '<dl class="record-fields">')
      .replace(/<\/table>/g, "</dl>")
      .replace(
        /<tr[^>]*><td>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><\/tr>/g,
        '<div class="record-field"><dt>$1</dt><dd>$2</dd></div>',
      );
    html = html.replace(
      /Member number|Member search|Member details|Balance summary|Savings balance|Search/g,
      (name) => physicalName(name, variant),
    );
    html = html.replace(
      "</style>",
      ".record-fields{margin:24px 0}.record-field{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:18px 0;border-bottom:1px solid #dfe6ef}.record-field dt{color:#51647d}.record-field dd{margin:0;font-weight:600}.record-field input{max-width:100%;width:100%}@media(max-width:600px){.record-field{grid-template-columns:1fr}} </style>",
    );
  }
  return html.replace(
    "<head>",
    '<head><meta name="ledger-layout" content="' + variant + '">',
  );
}
