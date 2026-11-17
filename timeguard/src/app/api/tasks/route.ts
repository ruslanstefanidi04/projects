import { NextResponse } from "next/server";
import { z } from "zod";
import { MR8_COMMIT_TASKS, MR8_PROJECT_NAME } from "@/shared/lib/mr8-task-seed";
import { getPrisma } from "@/shared/lib/prisma";
import { requireUserId } from "@/shared/lib/session";

const projectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const taskSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  note: z.string().max(2000).optional(),
});

const MR8_ACCOUNT = process.env.MR8_ACCOUNT_EMAIL?.trim().toLowerCase() ?? "";
const mr8Ready = new Set<string>();

async function ensureMr8(userId: string) {
  if (!MR8_ACCOUNT || mr8Ready.has(userId)) return;
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (user?.email.toLowerCase() !== MR8_ACCOUNT) {
    mr8Ready.add(userId);
    return;
  }
  const existing = await prisma.workProject.findFirst({
    where: { userId, name: { equals: MR8_PROJECT_NAME, mode: "insensitive" } },
  });
  if (existing) {
    const tasks = await prisma.workTask.findMany({
      where: { userId, projectId: existing.id },
      select: { id: true, title: true, note: true },
    });
    const byHash = new Map<string, string>(
      MR8_COMMIT_TASKS.map((item) => [item.hash, item.title]),
    );
    await Promise.all(
      tasks.map(async (task) => {
        const hash = task.note.split(",")[0]?.trim();
        const title = hash ? byHash.get(hash) : undefined;
        if (!title || title === task.title) return;
        await prisma.workTask.update({ where: { id: task.id }, data: { title } });
      }),
    );
    mr8Ready.add(userId);
    return;
  }
  await prisma.workProject.create({
    data: {
      userId,
      name: MR8_PROJECT_NAME,
      color: "#14b8a6",
      tasks: {
        create: MR8_COMMIT_TASKS.map((item, index) => ({
          userId,
          title: item.title,
          note: `${item.hash}, ${item.date}`,
          done: true,
          sort: index,
        })),
      },
    },
  });
  mr8Ready.add(userId);
}

export async function GET() {
  try {
    const userId = await requireUserId();
    await ensureMr8(userId);
    const prisma = getPrisma();
    const projects = await prisma.workProject.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      include: { tasks: { orderBy: [{ sort: "asc" }, { createdAt: "desc" }] } },
    });
    return NextResponse.json({ projects });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const body = await req.json();
    const prisma = getPrisma();

    if (body && typeof body === "object" && "projectId" in body) {
      const data = taskSchema.parse(body);
      const project = await prisma.workProject.findFirst({
        where: { id: data.projectId, userId },
      });
      if (!project) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      const task = await prisma.workTask.create({
        data: {
          userId,
          projectId: project.id,
          title: data.title,
          note: data.note ?? "",
        },
      });
      return NextResponse.json({ task }, { status: 201 });
    }

    const data = projectSchema.parse(body);
    const project = await prisma.workProject.create({
      data: {
        userId,
        name: data.name,
        color: data.color?.toLowerCase() ?? "#14b8a6",
      },
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (e) {
    if (e instanceof Response) return e;
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
