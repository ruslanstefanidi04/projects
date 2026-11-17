import { createRequire } from "module";
import { steamUserProxy } from "./proxy.mjs";
import { gates, sleepJitter } from "./pace.mjs";

const require = createRequire(import.meta.url);
const SteamUser = require("steam-user");
const SteamCommunity = require("steamcommunity");
const TradeOfferManager = require("steam-tradeoffer-manager");
const SteamTotp = require("steam-totp");

const sessions = new Map();

export function parseTradeUrl(url) {
  try {
    const u = new URL(String(url || "").trim());
    const partner = u.searchParams.get("partner") || "";
    const token = u.searchParams.get("token") || "";
    const steamId = partner ? (BigInt(partner) + 76561197960265728n).toString() : "";
    return { partner, token, steamId, url: u.toString() };
  } catch {
    return { partner: "", token: "", steamId: "", url: "" };
  }
}

function totp(shared) {
  if (!shared) return "";
  try {
    return SteamTotp.generateAuthCode(shared);
  } catch {
    return "";
  }
}

function loginOpts(acc) {
  const opts = {
    accountName: acc.login,
    password: acc.password
  };
  const code = totp(acc.sharedSecret);
  if (code) opts.twoFactorCode = code;
  return opts;
}

function wrap(acc) {
  const client = new SteamUser({
    autoRelogin: false,
    dataDirectory: null,
    ...steamUserProxy(acc.proxy)
  });
  const community = new SteamCommunity();
  const manager = new TradeOfferManager({
    steam: client,
    community,
    language: "en",
    useAccessToken: true
  });
  return { accId: acc.id, client, community, manager, ready: false, at: 0 };
}

function waitReady(sess) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("steam login timeout")), 45000);
    const fail = (e) => {
      clearTimeout(t);
      reject(e);
    };
    sess.client.once("error", fail);
    sess.client.once("loggedOn", () => {
      sess.client.setPersona(SteamUser.EPersonaState.Online);
    });
    sess.client.once("webSession", (_sid, cookies) => {
      sess.manager.setCookies(cookies, (err) => {
        if (err) return fail(err);
        sess.community.setCookies(cookies);
        sess.ready = true;
        sess.at = Date.now();
        clearTimeout(t);
        sess.client.removeListener("error", fail);
        resolve(sess);
      });
    });
  });
}

export async function getSession(acc) {
  const old = sessions.get(acc.id);
  if (old?.ready && Date.now() - old.at < 70 * 60 * 1000) return old;
  if (old) {
    try {
      old.client.logOff();
    } catch {}
    sessions.delete(acc.id);
  }
  await gates.login.take();
  await sleepJitter(400, 1600);
  const sess = wrap(acc);
  sessions.set(acc.id, sess);
  try {
    sess.client.logOn(loginOpts(acc));
    await waitReady(sess);
    gates.login.ok();
    return sess;
  } catch (e) {
    gates.login.bump();
    sessions.delete(acc.id);
    try {
      sess.client.logOff();
    } catch {}
    throw e;
  }
}

function inventory(manager) {
  return new Promise((resolve, reject) => {
    manager.getInventoryContents(730, 2, true, (err, items) => {
      if (err) reject(err);
      else resolve(items || []);
    });
  });
}

function sendOffer(offer) {
  return new Promise((resolve, reject) => {
    offer.send((err, status) => {
      if (err) reject(err);
      else resolve(status);
    });
  });
}

function acceptOffer(offer) {
  return new Promise((resolve, reject) => {
    offer.accept(false, (err, status) => {
      if (err) reject(err);
      else resolve(status);
    });
  });
}

function getOffers(manager) {
  return new Promise((resolve, reject) => {
    manager.getOffers(TradeOfferManager.EOfferFilter.ActiveOnly, (err, sent, received) => {
      if (err) reject(err);
      else resolve({ sent: sent || [], received: received || [] });
    });
  });
}

function confirm(community, identity, objectId) {
  return new Promise((resolve, reject) => {
    if (!identity || !objectId) return resolve(false);
    community.acceptConfirmationForObject(identity, objectId, (err) => {
      if (err) reject(err);
      else resolve(true);
    });
  });
}

export async function sendToVault(acc, tradeUrl) {
  const parsed = parseTradeUrl(tradeUrl);
  if (!parsed.token || !parsed.partner) throw new Error("vault trade url missing");
  const sess = await getSession(acc);
  await gates.inv.take();
  await sleepJitter(600, 2200);
  let items;
  try {
    items = await inventory(sess.manager);
    gates.inv.ok();
  } catch (e) {
    gates.inv.bump();
    throw e;
  }
  const mine = items.filter((i) => i.tradable);
  if (!mine.length) return { sent: 0, status: "empty" };
  await gates.tradeSend.take();
  await sleepJitter(900, 2800);
  const offer = sess.manager.createOffer(parsed.url);
  offer.addMyItems(mine);
  try {
    const status = await sendOffer(offer);
    gates.tradeSend.ok();
    if (acc.identitySecret && offer.id) {
      await gates.confirm.take();
      await sleepJitter(700, 2200);
      try {
        await confirm(sess.community, acc.identitySecret, offer.id);
        gates.confirm.ok();
      } catch {
        gates.confirm.bump();
      }
    }
    return { sent: mine.length, status, offerId: offer.id || "" };
  } catch (e) {
    gates.tradeSend.bump();
    throw e;
  }
}

export async function acceptIncoming(acc, allowIds) {
  const sess = await getSession(acc);
  await gates.tradeAccept.take();
  await sleepJitter(500, 1800);
  let offers;
  try {
    offers = await getOffers(sess.manager);
    gates.tradeAccept.ok();
  } catch (e) {
    gates.tradeAccept.bump();
    throw e;
  }
  const allow = new Set((allowIds || []).filter(Boolean));
  let n = 0;
  for (const offer of offers.received) {
    const partner = offer.partner?.getSteamID64?.() || "";
    if (allow.size && partner && !allow.has(partner)) continue;
    await sleepJitter(1800, 5200);
    try {
      await acceptOffer(offer);
      n += 1;
      if (acc.identitySecret && offer.id) {
        await gates.confirm.take();
        await sleepJitter(600, 2000);
        try {
          await confirm(sess.community, acc.identitySecret, offer.id);
          gates.confirm.ok();
        } catch {
          gates.confirm.bump();
        }
      }
    } catch {
      await sleepJitter(4000, 9000);
    }
  }
  return { accepted: n };
}
