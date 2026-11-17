import { NextResponse } from "next/server";
import { checkPassword, sessionCookie, signSession } from "@/lib/session";

export async function POST(req: Request) {
  const body = (await req.json()) as { user?: string; pass?: string };
  const user = (body.user || "").trim();
  const pass = body.pass || "";
  if (!checkPassword(user, pass)) {
    return NextResponse.json({ error: "bad credentials" }, { status: 401 });
  }
  const maxAge = 60 * 60 * 24 * 14;
  const token = await signSession(user, Date.now() + maxAge * 1000);
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", sessionCookie(token, maxAge));
  return res;
}
