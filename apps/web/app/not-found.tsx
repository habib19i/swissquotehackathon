import Link from "next/link";
import { Screen } from "../components/screen";

export default function NotFound() {
  return (
    <Screen
      actions={
        <Link href="/" className="button">
          Back to my safe
        </Link>
      }
    >
      <h1>This page does not exist</h1>
      <p className="lead">The link may be old or mistyped. Your safe and your money are not affected.</p>
    </Screen>
  );
}
