/** weekday order starting from weekStartsOn (0=Sun .. 6=Sat) */
export function orderedWeekdays(weekStartsOn: 0 | 1): number[] {
  return Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7);
}
