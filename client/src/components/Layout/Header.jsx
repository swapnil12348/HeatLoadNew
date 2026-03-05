import { ASHRAE_STANDARDS } from '../../constants/ashrae';

/**
 * Header
 * App-level header displaying title and active ASHRAE standard badges.
 * Standards sourced from constants/ashrae.js — single source of truth.
 */
export default function Header() {
  return (
    <header
      role="banner"
      style={{
        background: "linear-gradient(135deg, #1e3a5f 0%, #0f4c81 50%, #1565c0 100%)",
        borderBottom: "3px solid #f59e0b",
      }}
    >
      <div className="container mx-auto px-4 py-4">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 44, height: 44,
            background: "rgba(245,158,11,0.2)",
            border: "2px solid #f59e0b",
            borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22,
          }}>
            🌡
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: -0.5, lineHeight: 1.2 }}>
              AHU Heat Load Calculator
            </h1>
            <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.7)", fontWeight: 500 }}>
              ASHRAE Fundamentals — Air Conditioning Heat Load Analysis
            </p>
          </div>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {ASHRAE_STANDARDS.map((s) => (
            <span key={s} style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 1,
              background: "rgba(245,158,11,0.15)",
              color: "#fbbf24",
              border: "1px solid rgba(245,158,11,0.3)",
              borderRadius: 4,
              padding: "2px 8px",
            }}>
              {s}
            </span>
          ))}
        </div>
      </div>
    </header>
  );
}