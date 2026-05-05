// Server-side parser for CSV/XLSX/TSV uploads. Returns { headers, rows } from
// either format. Used by the import wizard.

import Papa from "papaparse";
import * as XLSX from "xlsx";

export type ParsedSheet = {
  headers: string[];
  rows: Array<Record<string, string>>;
  totalRows: number;
};

const MAX_ROWS = 50_000;

export function parseCsvBuffer(buffer: Buffer): ParsedSheet {
  const text = buffer.toString("utf8");
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transform: (v) => v?.toString().trim(),
  });
  if (result.errors.length > 0 && result.data.length === 0) {
    throw new Error(`CSV parse failed: ${result.errors[0]?.message}`);
  }
  const headers = result.meta.fields ?? [];
  const all = result.data as Array<Record<string, string>>;
  if (all.length > MAX_ROWS) {
    throw new Error(`Too many rows (${all.length}). Max ${MAX_ROWS} per upload — split into smaller files.`);
  }
  return { headers, rows: all, totalRows: all.length };
}

export function parseXlsxBuffer(buffer: Buffer): ParsedSheet {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("XLSX has no sheets");
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
    defval: "",
    raw: false,
    blankrows: false,
  });
  if (rows.length > MAX_ROWS) {
    throw new Error(`Too many rows (${rows.length}). Max ${MAX_ROWS} per upload — split into smaller files.`);
  }
  // Preserve column order from row 1.
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { headers, rows, totalRows: rows.length };
}

export function parseUploadedSheet(buffer: Buffer, fileName: string): ParsedSheet {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) {
    return parseCsvBuffer(buffer);
  }
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".xlsm")) {
    return parseXlsxBuffer(buffer);
  }
  // Try CSV as fallback by sniffing the first byte.
  if (buffer.length > 0 && (buffer[0] === 0x50)) {
    // ZIP magic — likely XLSX without extension
    return parseXlsxBuffer(buffer);
  }
  return parseCsvBuffer(buffer);
}
