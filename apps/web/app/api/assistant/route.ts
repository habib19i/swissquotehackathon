/**
 * POST /api/assistant { text, contacts: [{ name }] } -> PlannerResult.
 * Server-side so that the Hugging Face token never reaches the phone. Returns a draft only: the app's
 * rules resolve it and the client confirms the card with Face ID.
 */
import { PlannerUnavailableError, plan, type PlannerContact } from "../../../lib/assistant/planner";

const MAX_TEXT = 500;
const MAX_CONTACTS = 50;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { text?: unknown; contacts?: unknown };
  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
  if (!text) return Response.json({ error: "Please say or type what you want to send." }, { status: 400 });

  // Contacts' first names only: nothing else about the client or their contacts reaches the model.
  const contacts: PlannerContact[] = (Array.isArray(body.contacts) ? body.contacts : [])
    .slice(0, MAX_CONTACTS)
    .map((c) => ({ name: String((c as PlannerContact)?.name ?? "").slice(0, 40) }));

  try {
    return Response.json(await plan(text, contacts));
  } catch (err) {
    const status = err instanceof PlannerUnavailableError ? 503 : 500;
    return Response.json({ error: (err as Error).message }, { status });
  }
}
