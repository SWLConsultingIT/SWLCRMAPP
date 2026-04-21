"use client";

export default function PrintActions() {
  return (
    <div className="no-print" style={{ position: "fixed", top: 20, right: 20, display: "flex", gap: 8 }}>
      <button
        onClick={() => window.close()}
        style={{ padding: "8px 20px", borderRadius: 8, backgroundColor: "#374151", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
      >
        Close
      </button>
      <button
        onClick={() => window.print()}
        style={{ padding: "8px 20px", borderRadius: 8, backgroundColor: "#C9A83A", color: "#1A1A2E", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
      >
        Print / Save PDF
      </button>
    </div>
  );
}
