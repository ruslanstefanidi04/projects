import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/shared/lib/prisma";
import { requireUserId } from "@/shared/lib/session";
import { decryptSecret, encryptSecret } from "@/shared/lib/vault-crypto";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  username: z.string().max(300).optional(),
  password: z.string().max(500).optional(),
  url: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  category: z.string().max(60).optional(),
  favorite: z.boolean().optional(),
});

function mapEntry(
  e: {
    id: string;
    title: string;
    username: string;
    passwordEnc: string;
    url: string;
    notes: string;
    category: string;
    favorite: boolean;
    updatedAt: Date;
    createdAt: Date;
  },
  reveal: boolean,
) {
  return {
    id: e.id,
    title: e.title,
    username: e.username,
    password: reveal ? decryptSecret(e.passwordEnc) : "••••••••",
    url: e.url,
    notes: e.notes,
    category: e.category,
    favorite: e.favorite,
    updatedAt: e.updatedAt,
    createdAt: e.createdAt,
  };
}

export async function GET(req: Request) {
  try {
    const userId = await requireUserId();
    const reveal = new URL(req.url).searchParams.get("reveal") === "1";
    const prisma = getPrisma();
    const entries = await prisma.vaultEntry.findMany({
      where: { userId },
      orderBy: [{ favorite: "desc" }, { updatedAt: "desc" }],
    });
    return NextResponse.json({
      entries: entries.map((e) => mapEntry(e, reveal)),
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const data = createSchema.parse(await req.json());
    const prisma = getPrisma();
    const entry = await prisma.vaultEntry.create({
      data: {
        userId,
        title: data.title,
        username: data.username ?? "",
        passwordEnc: encryptSecret(data.password ?? ""),
        url: data.url ?? "",
        notes: data.notes ?? "",
        category: data.category ?? "login",
        favorite: data.favorite ?? false,
      },
    });
    return NextResponse.json(
      { entry: mapEntry(entry, true) },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof Response) return e;
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
