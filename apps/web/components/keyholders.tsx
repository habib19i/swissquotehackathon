import { CheckIcon } from "./icons";

const HOLDERS = ["You, on this phone", "Swissquote", "Independent safe-keeper"];

/** The three holders of the 2-of-3 key. `ready[i]` marks a holder whose piece is in place. */
export function KeyHolders({ ready, light = false }: { ready: boolean[]; light?: boolean }) {
  return (
    <ul className={`keyholders${light ? " light" : ""}`} aria-label="Who holds a piece of your key" style={{ listStyle: "none", margin: 0 }}>
      {HOLDERS.map((name, i) => (
        <li key={name} className="keyholder">
          <span className={`key${ready[i] ? " on" : ""}`}>{ready[i] && <CheckIcon size={16} />}</span>
          {name}
        </li>
      ))}
    </ul>
  );
}
