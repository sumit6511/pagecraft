import { connection } from "next/server";
import { checkBinaries } from "@/lib/server/run";


/** Reports which server-side converters are installed. */
export async function GET() {
  await connection(); // always evaluate at request time
  const tools = await checkBinaries();
  const ok = Object.values(tools).every(Boolean);
  return Response.json({ ok, tools }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
