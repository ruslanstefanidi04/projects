export type OutlookStance = "grow" | "watch" | "avoid";

export type OutlookPick = {
  name: string;
  stance: OutlookStance;
  confidence: number;
  thesis: string;
  risks: string;
  url?: string;
  minPrice?: number | null;
};

export type OutlookReport = {
  at: string;
  model: string;
  catalogSize: number;
  fed: number;
  regime: string;
  newsNotes: string;
  picks: OutlookPick[];
  disclaimer: string;
};
