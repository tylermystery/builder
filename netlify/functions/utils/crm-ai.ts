import OpenAI from "openai";

type Enrichment = {
  displayName: string | null;
  company: string | null;
  relationshipSummary: string;
  actionItems: string[];
};

export async function enrichCrmInteraction(input: {
  email: string;
  subject: string;
  excerpt: string;
  direction: string;
}): Promise<Enrichment | null> {
  if (process.env.CRM_AI_ENRICHMENT === "false") return null;
  try {
    const client = new OpenAI();
    const response = await client.responses.create({
      model: "gpt-5.4-mini",
      input: [
        {
          role: "system",
          content:
            "Extract concise CRM relationship context. Never infer marketing consent. Return JSON only with displayName, company, relationshipSummary, and actionItems.",
        },
        {
          role: "user",
          content: JSON.stringify(input),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "crm_enrichment",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              displayName: { type: ["string", "null"] },
              company: { type: ["string", "null"] },
              relationshipSummary: { type: "string" },
              actionItems: { type: "array", items: { type: "string" } },
            },
            required: ["displayName", "company", "relationshipSummary", "actionItems"],
          },
        },
      },
    });
    return JSON.parse(response.output_text) as Enrichment;
  } catch (error) {
    console.warn("[crm-ai] enrichment unavailable", (error as Error).message);
    return null;
  }
}
