import { ServiceStatus } from "./service-status";

/**
 * Placeholder home screen. Workstream 3 replaces this with the screens in CLAUDE.md section 10.
 */
export default function Home() {
  return (
    <main>
      <p className="prototype-banner">Swissquote Wallet — hackathon prototype</p>

      <section className="card">
        <h1 style={{ marginTop: 0 }}>Your safe</h1>
        <p>Your bitcoin and dollars, in your own safe. Protected by Swissquote.</p>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>System status</h2>
        <ServiceStatus />
      </section>
    </main>
  );
}
