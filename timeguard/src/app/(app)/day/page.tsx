import { DayBoard } from "@/widgets/day-board/day-board";

export default function DayPage({
  searchParams,
}: {
  searchParams: { weekday?: string };
}) {
  const raw = searchParams.weekday;
  const parsed = raw != null ? Number(raw) : undefined;
  const initialWeekday =
    parsed != null && Number.isInteger(parsed) && parsed >= 0 && parsed <= 6
      ? parsed
      : undefined;
  return <DayBoard initialWeekday={initialWeekday} />;
}
