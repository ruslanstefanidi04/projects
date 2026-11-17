import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/shared/lib/prisma";
import { requireUserId } from "@/shared/lib/session";
import { decryptSecret, encryptSecret } from "@/shared/lib/vault-crypto";

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  username: z.string().max(300).optional(),
  password: z.string().max(500).optional(),
  url: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  category: z.string().max(60).optional(),
  favorite: z.boolean().optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const userId = await requireUserId();
    const prisma = getPrisma();
    const entry = await prisma.vaultEntry.findFirst({
      where: { id: params.id, userId },
    });
    if (!entry) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({
      entry: {
        id: entry.id,
        title: entry.title,
        username: entry.username,
        password: decryptSecret(entry.passwordEnc),
        url: entry.url,
        notes: entry.notes,
        category: entry.category,
        favorite: entry.favorite,
        updatedAt: entry.updatedAt,
        createdAt: entry.createdAt,
      },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const userId = await requireUserId();
    const data = patchSchema.parse(await req.json());
    const prisma = getPrisma();
    const existing = await prisma.vaultEntry.findFirst({
      where: { id: params.id, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const entry = await prisma.vaultEntry.update({
      where: { id: params.id },
      data: {
        title: data.title,
        username: data.username,
        passwordEnc:
          data.password !== undefined
            ? encryptSecret(data.password)
            : undefined,
        url: data.url,
        notes: data.notes,
        category: data.category,
        favorite: data.favorite,
      },
    });
    return NextResponse.json({
      entry: {
        id: entry.id,
        title: entry.title,
        username: entry.username,
        password: decryptSecret(entry.passwordEnc),
        url: entry.url,
        notes: entry.notes,
        category: entry.category,
        favorite: entry.favorite,
        updatedAt: entry.updatedAt,
        createdAt: entry.createdAt,
      },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const userId = await requireUserId();
    const prisma = getPrisma();
    const existing = await prisma.vaultEntry.findFirst({
      where: { id: params.id, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    await prisma.vaultEntry.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
