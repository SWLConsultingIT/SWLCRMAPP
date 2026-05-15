"use client";

// Small client-side wrapper around window.print() so the report page can
// stay a server component (data fetch on the server, no client bundle for
// the heavy stuff).
export default function PrintButton() {
  return (
    <div className="no-print" style={{ position: "fixed", top: 16, right: 16, zIndex: 50, display: "flex", gap: 8 }}>
      <button
        onClick={() => window.print()}
        style={{
          padding: "8px 14px",
          borderRadius: 8,
          border: "1px solid #d1d5db",
          background: "#fff",
          color: "#111",
          fontWeight: 600,
          fontSize: 13,
          cursor: "pointer",
        }}>
        Print / Save as PDF
      </button>
    </div>
  );
}
