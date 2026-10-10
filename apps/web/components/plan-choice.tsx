import type { Plan } from "@sqw/shared";
import { Mock } from "./screen";

const PLANS: { id: Plan; name: string; price: string; description: string }[] = [
  {
    id: "premium",
    name: "Premium",
    price: "CHF 9 per month",
    description: "Swissquote pays every network fee for you, and keeps your recovery service running.",
  },
  {
    id: "standard",
    name: "Standard",
    price: "Free",
    description: "Recovery included. You pay the small network fee of each payment from your own bitcoin.",
  },
];

/** Premium or Standard (CLAUDE.md section 7). Prices are a mock for the prototype. */
export function PlanChoice({ value, onChange }: { value: Plan; onChange: (plan: Plan) => void }) {
  return (
    <div role="radiogroup" aria-label="Plan" className="plans">
      {PLANS.map((p) => (
        <button
          key={p.id}
          role="radio"
          aria-checked={value === p.id}
          className="plan"
          onClick={() => onChange(p.id)}
        >
          <span className="plan-head">
            <span className="row-title">{p.name}</span>
            <span className="tabular">
              {p.price} {p.id === "premium" && <Mock />}
            </span>
          </span>
          <span className="small muted">{p.description}</span>
        </button>
      ))}
    </div>
  );
}
