"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Check, Plus, Trash2 } from "lucide-react";
import { useLocale } from "@/shared/lib/locale-context";
import { cn } from "@/shared/lib/utils";
import { TaskDetailView } from "@/widgets/tasks/task-detail-view";

type Task = {
  id: string;
  title: string;
  note: string;
  detail: string;
  done: boolean;
};

type Project = {
  id: string;
  name: string;
  color: string;
  tasks: Task[];
};

const COLORS = ["#14b8a6", "#0ea5e9", "#f59e0b", "#f43f5e", "#8b5cf6", "#84cc16"];

type TaskCache = { projects: Project[]; activeId: string | null };

const taskMemory = new Map<string, TaskCache>();

function taskCacheKey(email: string) {
  return `tg-tasks-v1:${email}`;
}

function readTaskCache(email: string): TaskCache | null {
  const hit = taskMemory.get(email);
  if (hit) return hit;
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(taskCacheKey(email));
    if (!raw) return null;
    const data = JSON.parse(raw) as TaskCache;
    if (!Array.isArray(data?.projects)) return null;
    const cache = { projects: data.projects, activeId: data.activeId ?? null };
    taskMemory.set(email, cache);
    return cache;
  } catch {
    return null;
  }
}

function writeTaskCache(email: string, projects: Project[], activeId: string | null) {
  const cache = { projects, activeId };
  taskMemory.set(email, cache);
  try {
    localStorage.setItem(taskCacheKey(email), JSON.stringify(cache));
  } catch {
    // storage full or blocked
  }
}

export function TasksBoard() {
  const { t } = useLocale();
  const { data: session } = useSession();
  const email = session?.user?.email?.toLowerCase() ?? "";
  const [projects, setProjects] = useState<Project[]>(
    () => (email ? readTaskCache(email)?.projects ?? [] : []),
  );
  const [activeId, setActiveId] = useState<string | null>(
    () => (email ? readTaskCache(email)?.activeId ?? null : null),
  );
  const [settled, setSettled] = useState(
    () => Boolean(email && readTaskCache(email)),
  );
  const fetched = useRef(false);
  const [projectName, setProjectName] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [filter, setFilter] = useState<"all" | "open" | "done">("all");
  const [editing, setEditing] = useState<Task | null>(null);
  const [detailDraft, setDetailDraft] = useState("");
  const detailRef = useRef<HTMLTextAreaElement>(null);
  const toggleGen = useRef(new Map<string, number>());

  const load = useCallback(async () => {
    const res = await fetch("/api/tasks", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const list = (data.projects ?? []) as Project[];
    fetched.current = true;
    setSettled(true);
    setProjects(list);
    setActiveId((current) =>
      current && list.some((project) => project.id === current) ? current : list[0]?.id ?? null,
    );
  }, []);

  useLayoutEffect(() => {
    if (!email) return;
    const cached = readTaskCache(email);
    if (cached) {
      setProjects(cached.projects);
      setActiveId(cached.activeId);
      setSettled(true);
    }
    void load();
  }, [email, load]);

  useEffect(() => {
    if (!email) return;
    if (!fetched.current && projects.length === 0) return;
    writeTaskCache(email, projects, activeId);
  }, [email, projects, activeId]);

  const active = projects.find((p) => p.id === activeId) ?? projects[0] ?? null;
  const visible = useMemo(() => {
    const tasks = active?.tasks ?? [];
    if (filter === "open") return tasks.filter((task) => !task.done);
    if (filter === "done") return tasks.filter((task) => task.done);
    return tasks;
  }, [active, filter]);

  async function addProject() {
    const name = projectName.trim();
    if (!name) return;
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        color: COLORS[projects.length % COLORS.length],
      }),
    });
    const data = await res.json();
    setProjectName("");
    await load();
    if (data.project?.id) setActiveId(data.project.id);
  }

  async function addTask() {
    if (!active || !taskTitle.trim()) return;
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: active.id, title: taskTitle.trim() }),
    });
    setTaskTitle("");
    await load();
  }

  function setTaskDone(id: string, done: boolean) {
    setProjects((list) =>
      list.map((project) => ({
        ...project,
        tasks: project.tasks.map((item) => (item.id === id ? { ...item, done } : item)),
      })),
    );
  }

  function toggleTask(task: Task) {
    const next = !task.done;
    const gen = (toggleGen.current.get(task.id) ?? 0) + 1;
    toggleGen.current.set(task.id, gen);
    setTaskDone(task.id, next);
    void fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "task", done: next }),
    })
      .then((res) => {
        if (toggleGen.current.get(task.id) !== gen) return;
        if (!res.ok) setTaskDone(task.id, !next);
      })
      .catch(() => {
        if (toggleGen.current.get(task.id) !== gen) return;
        setTaskDone(task.id, !next);
      });
  }

  function setTaskDetail(id: string, detail: string) {
    setProjects((list) =>
      list.map((project) => ({
        ...project,
        tasks: project.tasks.map((item) => (item.id === id ? { ...item, detail } : item)),
      })),
    );
  }

  function openTask(task: Task) {
    setEditing(task);
    setDetailDraft(task.detail ?? "");
  }

  function wrapDetail(before: string, after: string, placeholder: string) {
    const el = detailRef.current;
    const start = el?.selectionStart ?? detailDraft.length;
    const end = el?.selectionEnd ?? detailDraft.length;
    const selected = detailDraft.slice(start, end) || placeholder;
    const next = `${detailDraft.slice(0, start)}${before}${selected}${after}${detailDraft.slice(end)}`;
    setDetailDraft(next);
    const caret = start + before.length + selected.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }

  function addHeading() {
    const el = detailRef.current;
    const start = el?.selectionStart ?? detailDraft.length;
    const lineStart = detailDraft.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const next = `${detailDraft.slice(0, lineStart)}## ${detailDraft.slice(lineStart)}`;
    setDetailDraft(next);
    requestAnimationFrame(() => el?.focus());
  }

  function saveDetail() {
    if (!editing) return;
    const id = editing.id;
    const previous = editing.detail ?? "";
    const detail = detailDraft.trim();
    setTaskDetail(id, detail);
    setEditing(null);
    void fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "task", detail }),
    })
      .then((res) => {
        if (!res.ok) setTaskDetail(id, previous);
      })
      .catch(() => setTaskDetail(id, previous));
  }

  async function removeTask(id: string) {
    await fetch(`/api/tasks/${id}?kind=task`, { method: "DELETE" });
    await load();
  }

  async function removeProject(id: string) {
    await fetch(`/api/tasks/${id}?kind=project`, { method: "DELETE" });
    setActiveId(null);
    await load();
  }

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100dvh-4rem)] lg:overflow-hidden">
      <header className="shrink-0">
        <p className="text-xs uppercase tracking-[0.28em] text-muted">{t.tasks.title}</p>
        <h1 className="mt-1 font-display text-3xl md:text-4xl">{t.tasks.title}</h1>
        <p className="mt-1 text-sm text-muted">{t.tasks.subtitle}</p>
      </header>

      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[260px_1fr]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-edge bg-panel/70 p-3 max-lg:max-h-40">
          <div className="mb-3 text-xs uppercase tracking-wider text-muted">
            {t.tasks.projects}
          </div>
          <div className="mb-3 flex gap-2">
            <input
              className="field"
              value={projectName}
              placeholder={t.tasks.projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addProject();
              }}
            />
            <button type="button" className="btn-primary px-3" onClick={() => void addProject()}>
              <Plus className="size-4" />
            </button>
          </div>
          {projects.length === 0 ? (
            settled ? <p className="px-1 text-sm text-muted">{t.tasks.emptyProjects}</p> : null
          ) : (
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain">
              {projects.map((project) => {
                const open = project.tasks.filter((task) => !task.done).length;
                const selected = active?.id === project.id;
                return (
                  <li key={project.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(project.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm",
                        selected ? "bg-accent/15 text-ink" : "hover:bg-surface",
                      )}
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: project.color }}
                      />
                      <span className="min-w-0 flex-1 truncate">{project.name}</span>
                      <span className="text-xs text-muted">{open}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="flex min-h-[calc(100dvh-7.5rem)] flex-col rounded-2xl border border-edge bg-panel/70 p-4 lg:min-h-0 lg:overflow-hidden">
          {active ? (
            <>
              <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-2xl">{active.name}</h2>
                <div className="flex items-center gap-1">
                  {(
                    [
                      ["all", t.tasks.all],
                      ["open", t.tasks.open],
                      ["done", t.tasks.done],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setFilter(key)}
                      className={cn(
                        "rounded-lg border px-2.5 py-1 text-xs",
                        filter === key
                          ? "border-accent/40 bg-accent/15 text-ink"
                          : "border-edge text-muted",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    title={t.tasks.delete}
                    className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger"
                    onClick={() => void removeProject(active.id)}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
              <div className="mb-4 flex shrink-0 gap-2">
                <input
                  className="field"
                  value={taskTitle}
                  placeholder={t.tasks.taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addTask();
                  }}
                />
                <button type="button" className="btn-primary" onClick={() => void addTask()}>
                  <Plus className="size-4" />
                  {t.tasks.addTask}
                </button>
              </div>
              {visible.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted">{t.tasks.emptyTasks}</p>
              ) : (
                <ul className="divide-y divide-edge lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
                  {visible.map((task) => (
                    <li key={task.id} className="flex items-start gap-3 py-3">
                      <button
                        type="button"
                        aria-pressed={task.done}
                        onClick={() => void toggleTask(task)}
                        className={cn(
                          "mt-0.5 inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border",
                          task.done
                            ? "border-accent bg-accent text-white"
                            : "border-muted/80 text-transparent",
                        )}
                      >
                        <Check className="size-3" strokeWidth={3} />
                      </button>
                      <button
                        type="button"
                        onClick={() => openTask(task)}
                        className="min-w-0 flex-1 rounded-lg px-1 text-left hover:bg-surface"
                      >
                        <div className={cn("text-sm", task.done && "text-muted line-through")}>
                          {task.title}
                        </div>
                        {task.note ? (
                          <div className="mt-0.5 font-mono text-[11px] text-muted">{task.note}</div>
                        ) : null}
                        {task.detail ? (
                          <>
                            <div className="mt-2 text-sm leading-relaxed text-muted lg:hidden">
                              <TaskDetailView text={task.detail} />
                            </div>
                            <div className="mt-1 hidden text-xs text-muted lg:line-clamp-2 lg:block">
                              <TaskDetailView text={task.detail} compact />
                            </div>
                          </>
                        ) : (
                          <div className="mt-1 text-[11px] text-muted/70">{t.tasks.addDetail}</div>
                        )}
                      </button>
                      <button
                        type="button"
                        title={t.tasks.delete}
                        className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger"
                        onClick={() => void removeTask(task.id)}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : settled ? (
            <p className="m-auto text-sm text-muted">{t.tasks.emptyProjects}</p>
          ) : null}
        </section>
      </div>
      {editing ? (
        <div
          className="fixed inset-0 z-[70] flex flex-col bg-black/40 p-3 backdrop-blur-sm max-md:pb-[calc(4.75rem+env(safe-area-inset-bottom)+0.75rem)] md:items-center md:justify-center md:p-4"
          onClick={() => setEditing(null)}
        >
          <div
            className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-hidden rounded-2xl border border-edge bg-panel p-4 md:h-[min(92dvh,52rem)] md:flex-none md:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-xs uppercase tracking-wider text-muted">{t.tasks.detail}</div>
            <h3 className="mt-1 font-display text-2xl">{editing.title}</h3>
            {editing.note ? (
              <div className="mt-1 font-mono text-[11px] text-muted">{editing.note}</div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-1">
              <button type="button" className="btn-ghost px-2.5 py-1 text-xs" onClick={addHeading}>
                {t.tasks.formatHeading}
              </button>
              <button type="button" className="btn-ghost px-2.5 py-1 text-xs font-semibold" onClick={() => wrapDetail("**", "**", t.tasks.formatBold)}>
                {t.tasks.formatBold}
              </button>
              <button type="button" className="btn-ghost px-2.5 py-1 text-xs italic" onClick={() => wrapDetail("*", "*", t.tasks.formatItalic)}>
                {t.tasks.formatItalic}
              </button>
              <button type="button" className="btn-ghost px-2.5 py-1 text-xs line-through" onClick={() => wrapDetail("~~", "~~", t.tasks.formatStrike)}>
                {t.tasks.formatStrike}
              </button>
            </div>
            <div className="mt-3 grid min-h-0 flex-1 grid-rows-2 gap-3 md:grid-cols-2 md:grid-rows-1">
              <textarea
                ref={detailRef}
                className="field h-full min-h-0 resize-none"
                value={detailDraft}
                placeholder={t.tasks.detailPlaceholder}
                onChange={(e) => setDetailDraft(e.target.value)}
                autoFocus
              />
              <div className="h-full min-h-0 overflow-y-auto rounded-xl border border-edge bg-surface/40 p-4">
                <div className="mb-2 text-[11px] uppercase tracking-wider text-muted">{t.tasks.preview}</div>
                {detailDraft.trim() ? (
                  <TaskDetailView text={detailDraft} />
                ) : (
                  <p className="text-sm text-muted">{t.tasks.detailPlaceholder}</p>
                )}
              </div>
            </div>
            <div className="mt-3 flex shrink-0 justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
                {t.tasks.cancel}
              </button>
              <button type="button" className="btn-primary" onClick={saveDetail}>
                {t.tasks.save}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
