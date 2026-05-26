// ICP × Channel matrix. Answers the single highest-leverage question for an
// SWL operator: which (ICP, channel) combination is producing the best reply
// rate? Today the dashboard surfaces ICP and channel separately — this fills
// the gap with a 2D view.
//
// Color encoding: z-score against the matrix's own distribution (not absolute
// thresholds). The viz self-scales whether the average reply rate is 5% or
// 25%, which is what you want — "good FOR US" beats "good in absolute terms".
//
// Cells with contacted < 10 are rendered as "n insuf." instead of a misleading
// % over a tiny sample. Same statistical floor used in the tables.

import Link from "next/link";
import { Share2, Mail, Phone, Smartphone, MessageSquare } from "lucide-react";
import { C } from "@/lib/design";

const channelMeta: Record<string, { Icon: React.ElementType; label: string }> = {
  linkedin: { Icon: Share2,        label: "LinkedIn" },
  email:    { Icon: Mail,          label: "Email" },
  call:     { Icon: Phone,         label: "Llamada" },
  whatsapp: { Icon: Smartphone,    label: "WhatsApp" },
  sms:      { Icon: MessageSquare, label: "SMS" },
};

type Matrix = {
  icps: { id: string; name: string }[];
  channels: string[];
  cells: {
    icpId: string;
    channel: string;
    contacted: number;
    replied: number;
    replyRate: number | null;
    zScore: number | null;
  }[];
  mean: number;
  stddev: number;
};

const gold = "var(--brand, #c9a83a)";

export default function IcpChannelMatrix({ matrix }: { matrix: Matrix }) {
  if (matrix.icps.length === 0 || matrix.channels.length === 0) {
    return (
      <div className="py-10 text-center text-[12px]" style={{ color: C.textMuted }}>
        Sin combinaciones ICP × canal aún.
        <br />
        <span className="text-[10.5px]" style={{ color: C.textDim }}>
          La matriz aparece con al menos una campaña por ICP.
        </span>
      </div>
    );
  }

  const cellByKey = new Map<string, Matrix["cells"][number]>();
  for (const c of matrix.cells) cellByKey.set(`${c.icpId}|${c.channel}`, c);

  return (
    <div className="overflow-x-auto">
      <table className="w-full" style={{ borderSpacing: "4px 4px", borderCollapse: "separate" }}>
        <thead>
          <tr>
            <th className="text-left px-2 py-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
              ICP
            </th>
            {matrix.channels.map(ch => {
              const meta = channelMeta[ch] ?? { Icon: Share2, label: ch };
              const Icon = meta.Icon;
              return (
                <th key={ch} className="text-center px-2 py-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
                  <span className="inline-flex items-center gap-1 justify-center">
                    <Icon size={10} /> {meta.label}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {matrix.icps.map(icp => (
            <tr key={icp.id}>
              <td className="px-2 py-1 text-[12.5px] font-medium max-w-[180px]" style={{ color: C.textPrimary }}>
                <span className="truncate inline-block max-w-full align-middle" title={icp.name}>{icp.name}</span>
              </td>
              {matrix.channels.map(ch => {
                const cell = cellByKey.get(`${icp.id}|${ch}`);
                return (
                  <td key={ch} className="p-0">
                    <Cell cell={cell} icpId={icp.id} channel={ch} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center justify-end gap-2 mt-3 px-2 text-[10.5px]" style={{ color: C.textDim }}>
        <span>Color por z-score</span>
        <div className="flex gap-[1px]">
          {[-2, -1, 0, 1, 2].map(z => (
            <div key={z} className="w-3.5 h-2.5 rounded-sm" style={{ background: zToColor(z) }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Cell({ cell, icpId, channel }: { cell: Matrix["cells"][number] | undefined; icpId: string; channel: string }) {
  if (!cell || cell.contacted === 0) {
    return (
      <div className="h-10 rounded-md flex items-center justify-center text-[10px]"
        style={{ background: C.surface, color: C.textDim }}
        title="Sin actividad"
      >
        —
      </div>
    );
  }
  if (cell.replyRate === null) {
    return (
      <div className="h-10 rounded-md flex flex-col items-center justify-center"
        style={{ background: C.surface, color: C.textDim }}
        title={`Volumen insuficiente: ${cell.contacted} contactos (mín 10)`}
      >
        <span className="text-[10px]">n insuf.</span>
        <span className="text-[9px] tabular-nums opacity-80">n={cell.contacted}</span>
      </div>
    );
  }

  const bg = zToColor(cell.zScore ?? 0);
  const fg = (cell.zScore ?? 0) >= 1.5 ? "#1A1505" : C.textPrimary;

  return (
    <Link
      href={icpId !== "_unknown"
        ? `/dashboard/icp/${icpId}?channel=${channel}`
        : `/leads?channel=${channel}`}
      className="h-10 rounded-md flex flex-col items-center justify-center transition-transform hover:scale-[1.02] hover:shadow-sm"
      style={{ background: bg, color: fg }}
      title={`${(cell.replyRate * 100).toFixed(1)}% reply rate sobre ${cell.contacted} contactos · click para detalle`}
    >
      <span className="text-[12.5px] font-semibold tabular-nums leading-none">
        {(cell.replyRate * 100).toFixed(1)}%
      </span>
      <span className="text-[9px] tabular-nums opacity-80 leading-none mt-0.5">
        n={cell.contacted}
      </span>
    </Link>
  );
}

/** 5-stop scale. High z-score → gold (SWL brand for wins). Low → red.
 * color-mix with transparent so it blends with the surface in light + dark. */
function zToColor(z: number): string {
  if (z >= 1.5) return `color-mix(in srgb, ${gold} 55%, transparent)`;
  if (z >= 0.5) return `color-mix(in srgb, ${gold} 28%, transparent)`;
  if (z >= -0.5) return `color-mix(in srgb, ${gold} 8%, transparent)`;
  if (z >= -1.5) return `color-mix(in srgb, #DC2626 16%, transparent)`;
  return `color-mix(in srgb, #DC2626 28%, transparent)`;
}
