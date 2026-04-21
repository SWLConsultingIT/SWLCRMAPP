import { NextResponse } from "next/server";

const AIRCALL_AUTH = Buffer.from(
  `${process.env.AIRCALL_API_ID}:${process.env.AIRCALL_API_TOKEN}`
).toString("base64");

export async function GET() {
  const res = await fetch("https://api.aircall.io/v1/numbers", {
    headers: { Authorization: `Basic ${AIRCALL_AUTH}` },
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    return NextResponse.json({ error: await res.text() }, { status: res.status });
  }
  const { numbers = [] } = (await res.json()) as { numbers: Array<{ id: number; name: string; digits: string; country: string }> };
  const shaped = numbers.map(n => ({
    id: n.id,
    name: n.name,
    digits: n.digits,
    country: n.country,
  }));
  return NextResponse.json({ numbers: shaped });
}
