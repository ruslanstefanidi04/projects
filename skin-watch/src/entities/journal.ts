export type JournalSide = "buy" | "sell";

export type JournalRow = {
  side: JournalSide;
  name: string;
  price: number;
  at: string;
};

export function pnl(rows: JournalRow[]) {
  let bought = 0;
  let sold = 0;
  for (const r of rows) {
    if (r.side === "buy") bought += r.price;
    else sold += r.price;
  }
  return { bought, sold, paper: sold - bought, deals: rows.length };
}
