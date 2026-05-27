// Compact per-channel touch strip used inside data tables.
//
// Renders 4 micro-stat chips side-by-side: LinkedIn Sent, LinkedIn message,
// Email, Call. Each chip = small channel icon + tabular count, color-coded
// to its channel. Zero counts render in dim text so the eye scans only the
// channels that fired. Designed for inline density (≤ 220px wide).

import { Share2, Mail, Phone, MessageSquare } from "lucide-react";
import { C } from "@/lib/design";

type Props = {
  linkedinSent: number;
  linkedinMsg: number;
  emailTouch: number;
  callTouch: number;
  /** Labels for accessible titles — keep i18n out of this primitive. */
  labels: { linkedinSent: string; linkedinMsg: string; emailTouch: string; callTouch: string };
};

export default function ChannelTouches({
  linkedinSent, linkedinMsg, emailTouch, callTouch, labels,
}: Props) {
  const items: { value: number; color: string; Icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>; title: string }[] = [
    { value: linkedinSent, color: "#0A66C2", Icon: Share2,        title: labels.linkedinSent },
    { value: linkedinMsg,  color: "#0A66C2", Icon: MessageSquare, title: labels.linkedinMsg },
    { value: emailTouch,   color: "#059669", Icon: Mail,          title: labels.emailTouch },
    { value: callTouch,    color: "#EA580C", Icon: Phone,         title: labels.callTouch },
  ];
  return (
    <div className="inline-flex items-center gap-1.5">
      {items.map((it, i) => {
        const has = it.value > 0;
        return (
          <span
            key={i}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10.5px] tabular-nums"
            style={{
              backgroundColor: has ? `color-mix(in srgb, ${it.color} 10%, transparent)` : "transparent",
              color: has ? it.color : C.textDim,
              border: has ? "none" : `1px dashed color-mix(in srgb, ${C.border} 65%, transparent)`,
            }}
            title={`${it.title}: ${it.value}`}
            aria-label={`${it.title}: ${it.value}`}
          >
            <it.Icon size={10} />
            <span className="font-semibold">{it.value}</span>
          </span>
        );
      })}
    </div>
  );
}
