/* Tiny Fighter Arena — app logic
 * Pollinations BYOP (OAuth authorization-code + PKCE) + generation APIs.
 * See README.md for setup details.
 */
"use strict";

/* ================= Constants ================= */
const AUTH_URL = "https://enter.pollinations.ai/authorize";
const TOKEN_URL = "https://enter.pollinations.ai/api/oauth/token";
const GEN_URL = "https://gen.pollinations.ai";
const APP_KEY = "pk_naWqNcRdJ6OdNWxx";        // replaced at deploy; falls back to hostname attribution
const REDIRECT_URI = location.origin + location.pathname;
const TEXT_MODEL = "openai/gpt-5.4-nano";
const IMAGE_MODEL = "flux";
const MAX_ROUNDS = 6;
const BUDGET = 12;

/* ================= PKCE helpers ================= */
function base64url(buf) {
  const s = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function sha256(str) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
}
async function makeChallenge() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
  const challenge = base64url(await sha256(verifier));
  return { verifier, challenge };
}

/* ================= Auth ================= */
const state = {
  token: sessionStorage.getItem("tfa_token") || null,
  verifier: sessionStorage.getItem("tfa_verifier") || null,
};
function setToken(t) {
  state.token = t;
  if (t) sessionStorage.setItem("tfa_token", t);
  else sessionStorage.removeItem("tfa_token");
}
function updateAuthUI() {
  const btn = document.getElementById("authBtn");
  const st = document.getElementById("authStatus");
  if (state.token) {
    btn.textContent = "Reconnect wallet";
    st.textContent = "Pollen wallet connected";
    document.querySelectorAll(".btn:not(.btn-auth)").forEach(b => (b.disabled = false));
  } else {
    btn.textContent = "Connect Pollen Wallet";
    st.textContent = state.token === null ? "Required to generate fighters" : "";
    document.querySelectorAll(".btn:not(.btn-auth)").forEach(b => (b.disabled = true));
  }
}
async function startAuth() {
  const { verifier, challenge } = await makeChallenge();
  sessionStorage.setItem("tfa_verifier", verifier);
  const p = new URLSearchParams({
    response_type: "code",
    client_id: APP_KEY,
    redirect_uri: REDIRECT_URI,
    scope: "profile usage",
    state: verifier.slice(0, 16),
    code_challenge: challenge,
    code_challenge_method: "S256",
    models: "text,image",
    budget: String(BUDGET),
    expiry: "7",
  });
  location.href = `${AUTH_URL}?${p.toString()}`;
}
async function exchangeCode(code) {
  const verifier = state.verifier || sessionStorage.getItem("tfa_verifier");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: APP_KEY,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error("Token exchange failed: " + res.status);
  const data = await res.json();
  if (!data.access_token) throw new Error("No access_token in response");
  setToken(data.access_token);
  sessionStorage.removeItem("tfa_verifier");
}
async function handleCallback() {
  const q = new URLSearchParams(location.search);
  const code = q.get("code");
  if (!code) return false;
  history.replaceState({}, "", location.pathname);
  try {
    await exchangeCode(code);
    updateAuthUI();
  } catch (e) {
    document.getElementById("authStatus").textContent = "Auth failed: " + e.message;
  }
  return true;
}

/* ================= API ================= */
async function api(path, options = {}) {
  const res = await fetch(GEN_URL + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${state.token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`${res.status} ${txt.slice(0, 160)}`);
  }
  return res;
}
async function chat(system, user, json = true) {
  const res = await api("/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: json ? 0.7 : 0.9,
    }),
  });
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  if (!json) return text;
  // Strip markdown fences if present
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = m ? m[1] : text;
  return JSON.parse(raw);
}
async function generateImage(prompt) {
  const res = await api("/v1/images/generations", {
    method: "POST",
    body: JSON.stringify({ model: IMAGE_MODEL, prompt, n: 1, size: "512x512" }),
  });
  const data = await res.json();
  const item = data.data?.[0];
  if (item?.url) return item.url;
  if (item?.b64_json) return "data:image/png;base64," + item.b64_json;
  throw new Error("No image returned");
}

/* ================= Game ================= */
const OPPONENTS = [
  { name: "Captain Clank", emoji: "🤖", epithet: "the Rusted Reaver", hp: 90, atk: 12, def: 6, powers: ["Oil Slick Slip", "Overclocked Fist"], weakness: "water and rust", taunt: "I may be rusty, but I never seize up in battle!" },
  { name: "Lady Fang", emoji: "🐍", epithet: "the Venomous Viper", hp: 80, atk: 15, def: 4, powers: ["Cobra Lunge", "Venom Coil"], weakness: "the cold", taunt: "One bite is all it takes, darling." },
  { name: "Grognak", emoji: "🧔", epithet: "the Boulder Breaker", hp: 110, atk: 10, def: 8, powers: ["Seismic Slam", "Rock Armor"], weakness: "nimble foes", taunt: "I punch mountains. What can you punch?" },
  { name: "Wisp", emoji: "👻", epithet: "the Starlight Trickster", hp: 70, atk: 14, def: 3, powers: ["Phase Dash", "Starlight Burst"], weakness: "bright light", taunt: "Catch me if you can!" },
];

const game = {
  player: null,
  opponent: null,
  log: [],
  round: 0,
  busy: false,
};

const SYSTEMS = {
  forge: `You are the arena announcer. Turn the user's one-line fighter idea into a JSON fighter profile. Reply with ONLY valid JSON, no markdown:
{"name":"short catchy name","epithet":"short epithet e.g. the Fire-Breathing Pirate","appearance":"one vivid sentence","powers":["power one (short)","power two (short)"],"weakness":"one short weakness","taunt":"one short trash-talk line","hp":number 70-120,"atk":number 8-16,"def":number 2-9}
Keep it playful, tiny, and arena-ready.`,
  battle: `You are the commentated battle engine for Tiny Fighter Arena. Two fighters face off in short rounds. Each round both may act. Reply with ONLY valid JSON, no markdown:
{"actions":[{"by":"<fighter name>","action":"<short attack/special/defend>","effect":"<damage|heal|miss>","amount":<number>,"flavor":"<one vivid TV-commentator sentence>"}]}
Honor weaknesses and powers. Damage roughly (atk - def) clamped 0..atk, crits occasionally ~1.5x. Keep HP within 0..max. If a fighter is down, others' actions may celebrate. Total max 2 actions per round.`,
  epilogue: `You are the arena announcer. Write the official battle report for the finished match. Reply with a short block of text (max 3 sentences), hype included. No JSON.`,
};

function show(id, on) { document.getElementById(id).classList.toggle("hidden", !on); }
function setStatus(msg, err = false) {
  const el = document.getElementById("createStatus");
  el.innerHTML = msg || "";
  el.classList.toggle("error", err);
}
function setLogStatus(msg) {
  const el = document.createElement("div");
  el.className = "log-line";
  el.innerHTML = `<span class="spinner"></span>${msg}`;
  document.getElementById("battleLog").appendChild(el);
  return el;
}

async function forgeFighter(desc) {
  const profile = await chat(SYSTEMS.forge, `Fighter idea: "${desc}"`);
  const portrait = await generateImage(`Tiny cartoon arena fighter: ${profile.name}, ${profile.appearance}. Chibi style, vibrant colors, full body, plain arena background.`);
  return { ...profile, desc, portrait };
}

function renderFighter(f) {
  const card = document.getElementById("fighterCard");
  card.innerHTML = `
    <div class="fighter-card">
      <img src="${f.portrait}" alt="${f.name}" onerror="this.outerHTML='<div class=&quot;img-ph&quot;>⚔️</div>'">
      <div class="fighter-info">
        <h3>${f.name}</h3>
        <div class="epithet">${f.epithet}</div>
        <div class="stats">
          <span class="stat">❤️ HP ${f.hp}</span>
          <span class="stat">⚔️ ATK ${f.atk}</span>
          <span class="stat">🛡️ DEF ${f.def}</span>
        </div>
        <ul class="powers">${f.powers.map(p => `<li>✨ ${p}</li>`).join("")}</ul>
        <div class="weakness">⚠️ Weakness: ${f.weakness}</div>
        <div class="taunt">“${f.taunt}”</div>
      </div>
    </div>`;
}

function renderOpponents() {
  const list = document.getElementById("opponentList");
  list.innerHTML = "";
  OPPONENTS.forEach((o, i) => {
    const el = document.createElement("div");
    el.className = "opponent";
    el.innerHTML = `
      <div class="o-emoji">${o.emoji}</div>
      <div class="o-name">${o.name}</div>
      <div class="o-epithet">${o.epithet}</div>
      <div class="o-stats">HP ${o.hp} · ATK ${o.atk} · DEF ${o.def}</div>`;
    el.onclick = () => {
      list.querySelectorAll(".opponent").forEach(x => x.classList.remove("sel"));
      el.classList.add("sel");
      game.opponent = { ...o };
      document.getElementById("fightBtn").classList.remove("hidden");
    };
    list.appendChild(el);
  });
}

function addLog(text, cls = "") {
  const el = document.createElement("div");
  el.className = "log-line " + cls;
  el.textContent = text;
  document.getElementById("battleLog").appendChild(el);
  document.getElementById("battleLog").scrollTop = document.getElementById("battleLog").scrollHeight;
}
function renderHUD() {
  const p = game.player, o = game.opponent;
  const pPct = Math.max(0, Math.round((p.hp / p.maxHp) * 100));
  const oPct = Math.max(0, Math.round((o.hp / o.maxHp) * 100));
  document.getElementById("battleHUD").innerHTML = `
    <div class="hud-side">
      <img src="${p.portrait}" alt="">
      <div class="hname">${p.name}</div>
      <div class="hpbar ${pPct <= 25 ? "low" : ""}"><div style="width:${pPct}%"></div></div>
      <small>${p.hp}/${p.maxHp}</small>
    </div>
    <div class="vs">VS</div>
    <div class="hud-side">
      <img src="${o.emoji}" alt="" style="font-size:3rem;line-height:100px" onerror="this.style.fontSize='3rem';this.textContent='${o.emoji}'">
      <div class="hname">${o.name}</div>
      <div class="hpbar ${oPct <= 25 ? "low" : ""}"><div style="width:${oPct}%"></div></div>
      <small>${o.hp}/${o.maxHp}</small>
    </div>`;
}

async function battleRound() {
  game.round++;
  const sys = SYSTEMS.battle;
  const usr = `Round ${game.round}.\n${game.player.name} (HP ${game.player.hp}/${game.player.maxHp}, ATK ${game.player.atk}, DEF ${game.player.def}, powers: ${game.player.powers.join(", ")}, weakness: ${game.player.weakness})\nvs\n${game.opponent.name} (HP ${game.opponent.hp}/${game.opponent.maxHp}, ATK ${game.opponent.atk}, DEF ${game.opponent.def}, powers: ${game.opponent.powers.join(", ")}, weakness: ${game.opponent.weakness})\n\nDescribe what happens this round.`;
  const waiter = setLogStatus(`Round ${game.round}: commentators are watching...`);
  let actions;
  try {
    actions = (await chat(sys, usr)).actions || [];
  } catch (e) {
    waiter.remove();
    throw e;
  }
  waiter.remove();
  for (const a of actions.slice(0, 2)) {
    addLog(`[${a.action}] ${a.flavor}`, "log-flavor");
    const target = a.by === game.player.name ? game.player : game.opponent;
    if (a.effect === "damage") {
      target.hp = Math.max(0, target.hp - a.amount);
      addLog(`${a.by} lands ${a.amount} damage! ${target.name} → HP ${target.hp}`, "log-dmg");
    } else if (a.effect === "heal") {
      target.hp = Math.min(target.maxHp, target.hp + a.amount);
      addLog(`${a.by} heals ${a.amount}. ${target.name} → HP ${target.hp}`, "log-heal");
    } else {
      addLog(`${a.by} shakes it off.`, "log-flavor");
    }
  }
  renderHUD();
}

async function startBattle() {
  const p = game.player, o = game.opponent;
  p.maxHp = p.hp; o.maxHp = o.hp;
  game.log = []; game.round = 0;
  show("battlePanel", true);
  document.getElementById("fightBtn").classList.add("hidden");
  document.getElementById("battleLog").innerHTML = "";
  addLog(`THE REF BELLOWS: ${p.name} vs ${o.name}!`, "");
  renderHUD();
  try {
    while (game.round < MAX_ROUNDS && p.hp > 0 && o.hp > 0) {
      await battleRound();
    }
    await finishBattle();
  } catch (e) {
    addLog("⚠️ The arena computer glitched: " + e.message, "error");
  }
}

async function finishBattle() {
  const p = game.player, o = game.opponent;
  let winner, loser;
  if (p.hp <= 0 && o.hp <= 0) { winner = null; loser = null; }
  else { winner = p.hp > o.hp ? p : o; loser = winner === p ? o : p; }
  let report = winner
    ? `${winner.name} wins the Tiny Fighter Arena crown!`
    : "Double knockout! The arena can't decide — both fighters are down!";
  try {
    const sys = SYSTEMS.epilogue;
    const usr = `Fight summary:\n${p.name} (HP ${p.hp}/${p.maxHp}) vs ${o.name} (HP ${o.hp}/${o.maxHp})\nRounds: ${game.round}. Winner: ${winner ? winner.name : "none"}.`;
    report = await chat(sys, usr, false);
  } catch { /* fall back to default report */ }
  const box = document.getElementById("resultBox");
  box.textContent = `${report}\n\n— Battle record —\n${p.name} (${p.epithet}): ${p.hp}/${p.maxHp} HP remaining\n${o.name} (${o.epithet}): ${o.hp}/${o.maxHp} HP remaining\nRounds fought: ${game.round}\nArena verdict: ${winner ? winner.name + " wins!" : "draw"}`;
  show("resultPanel", true);
  document.getElementById("battlePanel").scrollIntoView({ behavior: "smooth" });
}

/* ================= UI wiring ================= */
function init() {
  document.getElementById("authBtn").onclick = startAuth;
  document.getElementById("createForm").onsubmit = async (e) => {
    e.preventDefault();
    if (!state.token) { setStatus("Connect your Pollen wallet first.", true); return; }
    if (game.busy) return;
    game.busy = true;
    const desc = document.getElementById("fighterDesc").value.trim();
    const btn = document.getElementById("createBtn");
    btn.disabled = true;
    setStatus('<span class="spinner"></span>Forging your warrior...');
    try {
      game.player = await forgeFighter(desc);
      renderFighter(game.player);
      renderOpponents();
      show("fighterPanel", true);
      setStatus("");
      document.getElementById("fighterPanel").scrollIntoView({ behavior: "smooth" });
    } catch (err) {
      setStatus("Forge failed: " + err.message, true);
    } finally {
      btn.disabled = false;
      game.busy = false;
    }
  };
  document.getElementById("fightBtn").onclick = startBattle;
  document.getElementById("shareBtn").onclick = () => {
    const txt = document.getElementById("resultBox").textContent;
    navigator.clipboard.writeText(txt).then(() => {
      const b = document.getElementById("shareBtn");
      b.textContent = "Copied!";
      setTimeout(() => (b.textContent = "Copy battle report"), 1500);
    });
  };
  document.getElementById("rematchBtn").onclick = () => {
    const o = OPPONENTS.find(x => x.name === game.opponent.name);
    game.opponent = { ...o };
    document.getElementById("battleLog").innerHTML = "";
    show("resultPanel", false);
    startBattle();
  };
  document.getElementById("newFighterBtn").onclick = () => {
    show("resultPanel", false);
    show("battlePanel", false);
    show("fighterPanel", false);
    document.getElementById("fighterDesc").value = "";
    document.getElementById("fighterDesc").focus();
  };
  // Prefill from share link ?f=...
  const q = new URLSearchParams(location.search);
  const f = q.get("f");
  if (f) document.getElementById("fighterDesc").value = f;

  handleCallback().then(() => updateAuthUI());
  updateAuthUI();
}
document.addEventListener("DOMContentLoaded", init);
