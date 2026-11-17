export type AccountStatus =
  | "idle"
  | "starting"
  | "steam"
  | "cs2"
  | "queued"
  | "ingame"
  | "trading"
  | "error"
  | "offline"
  | "warmup"
  | "idleplay";

export type MatchKind =
  | "competitive"
  | "premier"
  | "wingman"
  | "deathmatch"
  | "casual";

export type NetworkInfo = {
  steamOk: boolean;
  pingMs: number | null;
  inGame: boolean;
  ipc: string | null;
};

export type InventoryItem = {
  assetId: string;
  classId: string;
  name: string;
  type: string;
  icon: string;
  rarity: string;
  tradable: boolean;
};

export type Account = {
  id: string;
  login: string;
  password: string;
  steamId: string;
  sharedSecret: string;
  identitySecret: string;
  steamPath: string;
  ipcName: string;
  proxy: string;
  enabled: boolean;
  matchKind: MatchKind;
  connectHost: string;
  persona: string;
  avatar: string;
  status: AccountStatus;
  lastError: string;
  network: NetworkInfo;
  inventory: InventoryItem[];
  inventoryAt: number;
  workerAt: number;
  pidSteam: number | null;
  pidCs: number | null;
  fpsCap: number;
  lastTradeAt: number;
  tradeNote: string;
  passMatches: number;
  rewardsClaimed: boolean;
  passDone: boolean;
  proxyId: string;
  warmupUntil: number;
  warmupDone: boolean;
  warmupDay: string;
  warmupDayMs: number;
  warmupDayTarget: number;
  lastCsWarmAt: number;
  warmupLicensed: boolean;
  warmupNote: string;
  testOnly: boolean;
  email: string;
  steamSession: Record<string, string>;
  /** hyper-v slot override; empty = derived from login */
  vmSlot: string;
  createdAt: number;
  updatedAt: number;
};

export type CommandKind =
  | "launch"
  | "stop"
  | "queue"
  | "connect"
  | "refresh"
  | "sendVault"
  | "acceptTrades"
  | "markClaimed"
  | "test"
  | "guard";

export type Command = {
  id: string;
  accountId: string;
  kind: CommandKind;
  payload: string;
  createdAt: number;
};

export type Settings = {
  vaultTradeUrl: string;
  vaultSteamId: string;
  vaultAccountId: string;
  botEnabled: boolean;
  botNote: string;
  autoMatch: boolean;
  batchSize: number;
  passTarget: number;
  cycleRunning: boolean;
  proxyPerGroup: number;
  warmupEnabled: boolean;
};

export type ProxyEntry = {
  id: string;
  raw: string;
  maxSlots: number;
};

export type StoreShape = {
  accounts: Account[];
  commands: Command[];
  settings: Settings;
  proxies: ProxyEntry[];
  steamMetaAt: number;
  gone: string[];
};
