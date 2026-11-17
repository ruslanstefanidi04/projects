export const EXPENSE_CATEGORIES = [
  "food",
  "transport",
  "housing",
  "entertainment",
  "health",
  "shopping",
  "subscriptions",
  "other",
] as const;

export const INCOME_CATEGORIES = [
  "salary",
  "freelance",
  "investments",
  "gifts",
  "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];

export const CATEGORY_SEEDS: {
  key: string;
  kind: "expense" | "income" | "both";
  emoji: string;
  color: string;
}[] = [
  { key: "food", kind: "expense", emoji: "🍔", color: "#f59e0b" },
  { key: "transport", kind: "expense", emoji: "🚗", color: "#0ea5e9" },
  { key: "housing", kind: "expense", emoji: "🏠", color: "#8b5cf6" },
  { key: "entertainment", kind: "expense", emoji: "🎬", color: "#f43f5e" },
  { key: "health", kind: "expense", emoji: "💊", color: "#14b8a6" },
  { key: "shopping", kind: "expense", emoji: "🛍️", color: "#84cc16" },
  { key: "subscriptions", kind: "expense", emoji: "🔁", color: "#64748b" },
  { key: "salary", kind: "income", emoji: "💼", color: "#14b8a6" },
  { key: "freelance", kind: "income", emoji: "💻", color: "#0ea5e9" },
  { key: "investments", kind: "income", emoji: "📈", color: "#84cc16" },
  { key: "gifts", kind: "income", emoji: "🎁", color: "#f59e0b" },
  { key: "other", kind: "both", emoji: "✨", color: "#94a3b8" },
];

export const CATEGORY_PALETTE = [
  "#f59e0b",
  "#0ea5e9",
  "#8b5cf6",
  "#f43f5e",
  "#14b8a6",
  "#84cc16",
  "#64748b",
  "#f97316",
  "#eab308",
  "#ec4899",
  "#6366f1",
  "#94a3b8",
];

export const CATEGORY_EMOJIS = [
  "🍔",
  "☕",
  "🚗",
  "🏠",
  "🎬",
  "💊",
  "🛍️",
  "📱",
  "💼",
  "💻",
  "📈",
  "🎁",
  "✈️",
  "🎮",
  "📚",
  "💡",
  "🐶",
  "✨",
  "🧾",
  "🎯",
];

export const CATEGORY_COLORS: Record<string, string> = {
  food: "#f59e0b",
  transport: "#0ea5e9",
  housing: "#8b5cf6",
  entertainment: "#f43f5e",
  health: "#14b8a6",
  shopping: "#84cc16",
  subscriptions: "#64748b",
  salary: "#14b8a6",
  freelance: "#0ea5e9",
  investments: "#84cc16",
  gifts: "#f59e0b",
  other: "#94a3b8",
};
