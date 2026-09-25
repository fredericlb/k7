// settings.js — the window's six tabs. The audio list IS the ranking: what is on screen, in
// the order it is on screen, is what `audio.priority` gets sent on every move. The plugin list
// is read-only — the engine's catalogue, and the rescan that refills it. Sessions is what the
// engine holds right now; Sync is where a set list may be copied; st0 instances is who this
// engine is connected to; System is the machine.
// The drag is pointer-driven rather than HTML5 dnd: one behaviour across the three webviews,
// and the dragged node stays alive under its pointer capture.

const api = window.__TAURI__;

const audioList = document.getElementById("audio");
const audioEmpty = document.getElementById("audio-empty");
const pluginList = document.getElementById("plugins");
const pluginCount = document.getElementById("plugin-count");
const filter = document.getElementById("filter");
const rescan = document.getElementById("rescan");
const sessionList = document.getElementById("sessions");
const sessionsEmpty = document.getElementById("sessions-empty");
const systemList = document.getElementById("system");
const adopted = document.getElementById("adopted");
const syncList = document.getElementById("sync");
const syncEmpty = document.getElementById("sync-empty");
const syncName = document.getElementById("sync-name");
const syncUri = document.getElementById("sync-uri");
const syncAdd = document.getElementById("sync-add");
const syncError = document.getElementById("sync-error");
const instanceList = document.getElementById("instances");
const instancesEmpty = document.getElementById("instances-empty");
const instanceForm = document.getElementById("instance-form");
const instanceUrl = document.getElementById("instance-url");
const instanceError = document.getElementById("instance-error");
const instanceAdd = document.getElementById("instance-add");

let dragging = null;
let moved = false;
let plugins = [];
let counted = null;
let running = false;
/** The targets as the last snapshot reported them — what an add or a remove is applied TO. */
let targets = [];
/** The instances as the last snapshot reported them, so an add can say "already connected". */
let instances = [];
/** A mistake caught HERE, before anything was sent; the supervisor's own verdict arrives as `instanceCheck`. */
let localError = "";
/** The supervisor's word on the last add: asking its registry, or why nothing was added. */
let instanceCheck = null;

if (!api) {
  audioEmpty.hidden = false;
  audioEmpty.textContent = "This window cannot reach the tray.";
}

// --- the audio ranking ------------------------------------------------------

/** The names in the order they are ON SCREEN — the ranking this window is about to commit. */
function order() {
  return [...audioList.children].map((n) => n.dataset.name);
}

/** Send the ranking up. The supervisor echoes a snapshot, which is what redraws us. */
function commit(names) {
  api.core.invoke("audio_rank", { names });
}

function detail(row, ranked) {
  if (!row.present) return "not connected — it keeps its place until you say otherwise";
  const type = row.deviceType || "audio device";
  if (row.current) return `${type} · in use`;
  return ranked ? type : `${type} · not ranked`;
}

/** Draw one row at its CURRENT place, which is what a move has to redo and nothing else. */
function paint(node, i) {
  const row = node.row;
  // Once a drag has happened every visible row is ranked, so every row shows its number.
  const ranked = moved || row.rank !== null;
  node.querySelector(".rank").textContent = ranked ? `${i + 1}.` : "—";
  node.querySelector(".detail").textContent = detail(row, ranked);
}

function buildAudio(row) {
  const node = document.createElement("li");
  node.className = row.present ? "row" : "row absent";
  node.dataset.name = row.name;
  node.tabIndex = 0;
  node.row = row;
  node.innerHTML =
    '<span class="rank"></span><span class="body">' +
    '<span class="name"></span><br /><span class="detail"></span>' +
    "</span>";
  const name = node.querySelector(".name");
  name.textContent = row.name;
  if (row.current) {
    const dot = document.createElement("span");
    dot.className = "live";
    dot.textContent = " ●";
    name.append(dot);
  }
  // Only a name with no hardware behind it gets this: it is the one thing a drag cannot do.
  if (!row.present) {
    const forget = document.createElement("button");
    forget.className = "forget";
    forget.type = "button";
    forget.textContent = "Forget";
    forget.addEventListener("pointerdown", (e) => e.stopPropagation());
    forget.addEventListener("click", () =>
      commit(order().filter((n) => n !== row.name)),
    );
    node.append(forget);
  }
  node.addEventListener("pointerdown", (e) => grab(e, node));
  node.addEventListener("keydown", (e) => key(e, node));
  return node;
}

function renderAudio(rows) {
  moved = false;
  audioList.replaceChildren(...rows.map(buildAudio));
  [...audioList.children].forEach(paint);
  audioEmpty.hidden = rows.length > 0;
  audioEmpty.textContent = running
    ? "The engine reports no interface."
    : "Start the engine to see your interfaces.";
}

function grab(e, node) {
  if (e.button !== 0) return;
  dragging = node;
  moved = false;
  node.setPointerCapture(e.pointerId);
  node.classList.add("dragging");
}

/** Swap with the neighbour the pointer has crossed; equal-height rows make that the whole geometry. */
function drag(e) {
  if (!dragging) return;
  const over = document.elementFromPoint(e.clientX, e.clientY)?.closest(".row");
  if (!over || over === dragging || over.parentElement !== audioList) return;
  const kids = [...audioList.children];
  const before =
    kids.indexOf(over) < kids.indexOf(dragging) ? over : over.nextElementSibling;
  audioList.insertBefore(dragging, before);
  moved = true;
  [...audioList.children].forEach(paint);
}

function drop() {
  if (!dragging) return;
  dragging.classList.remove("dragging");
  dragging = null;
  if (moved) commit(order());
}

/** ↑ and ↓ on a selected row: the same move, for a hand that would rather not drag. */
function key(e, node) {
  const step = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
  if (!step) return;
  e.preventDefault();
  const kids = [...audioList.children];
  const to = kids.indexOf(node) + step;
  if (to < 0 || to >= kids.length) return;
  audioList.insertBefore(node, step < 0 ? kids[to] : kids[to].nextElementSibling);
  moved = true;
  [...audioList.children].forEach(paint);
  node.focus();
  commit(order());
}

// --- the plugin catalogue ---------------------------------------------------

function buildPlugin(p) {
  const node = document.createElement("li");
  node.className = "row";
  node.innerHTML =
    '<span class="body"><span class="name"></span><br />' +
    '<span class="detail"></span></span><span class="badge"></span>';
  node.querySelector(".name").textContent = p.name;
  // The role is the engine's word, and it is the one thing a name usually does not say.
  node.querySelector(".detail").textContent = [p.manufacturer, p.role]
    .filter(Boolean)
    .join(" · ");
  node.querySelector(".badge").textContent = p.format;
  return node;
}

function renderPlugins() {
  const q = filter.value.trim().toLowerCase();
  const shown = q
    ? plugins.filter((p) =>
        `${p.name} ${p.manufacturer} ${p.format}`.toLowerCase().includes(q),
      )
    : plugins;
  pluginList.replaceChildren(...shown.map(buildPlugin));
  // A null count is the scan still running, and saying "no plugins" over it would be a lie.
  pluginCount.textContent = !running
    ? "Start the engine to see the installed plugins."
    : counted === null
      ? "Scanning…"
      : q
        ? `${shown.length} of ${counted} plugins`
        : `${counted} plugins`;
  rescan.disabled = !running;
}

// --- the sessions -----------------------------------------------------------

/** One plugin whose own editor can open — the click lands on the ENGINE's screen, not here. */
function buildPluginUi(p) {
  const node = document.createElement("li");
  node.className = "row nested";
  node.innerHTML = '<span class="body"><span class="name"></span></span>';
  node.querySelector(".name").textContent = p.name;
  const open = document.createElement("button");
  open.className = "forget";
  open.type = "button";
  open.textContent = "Open";
  open.addEventListener("click", () =>
    api?.core.invoke("plugin_show_ui", { session: p.session, id: p.id }),
  );
  node.append(open);
  return node;
}

function buildSession(s) {
  const node = document.createElement("li");
  node.innerHTML =
    '<div class="row"><span class="body"><span class="name"></span><br />' +
    '<span class="detail"></span></span></div>';
  // The default session has no name on the wire; it needs one here, or the row reads as a
  // session with no id rather than THE unnamed one.
  node.querySelector(".name").textContent = s.id || "(default)";
  const what = s.loaded
    ? `${s.project || "untitled"} · ${s.tracks} track${s.tracks === 1 ? "" : "s"}`
    : "nothing loaded";
  // Two live facts, and only when true: a column of "not playing · 0 listening" would bury
  // the one session that IS playing among the ones that are not.
  const live = [s.playing ? "▶ playing" : "", s.listeners ? `♫ ${s.listeners} listening` : ""]
    .filter(Boolean)
    .join(" · ");
  node.querySelector(".detail").textContent = live ? `${what} · ${live}` : what;
  const drop = document.createElement("button");
  drop.className = "forget";
  drop.type = "button";
  drop.textContent = "Drop";
  drop.addEventListener("click", () => api?.core.invoke("session_drop", { id: s.id }));
  node.querySelector(".row").append(drop);
  if (s.plugins.length) {
    const sub = document.createElement("ul");
    sub.replaceChildren(...s.plugins.map(buildPluginUi));
    node.append(sub);
  }
  return node;
}

function renderSessions(sessions, orphans) {
  const nodes = sessions.map(buildSession);
  // Kept rather than dropped: the two lists are polled apart, and a row must not vanish
  // because they disagreed for one frame.
  if (orphans.length) {
    const stray = document.createElement("li");
    stray.innerHTML = '<p class="empty">Plugins in no listed session</p>';
    const sub = document.createElement("ul");
    sub.replaceChildren(...orphans.map(buildPluginUi));
    stray.append(sub);
    nodes.push(stray);
  }
  sessionList.replaceChildren(...nodes);
  sessionsEmpty.hidden = nodes.length > 0;
  sessionsEmpty.textContent = running
    ? "No app is driving this engine."
    : "Start the engine to see what is driving it.";
}

// --- the machine ------------------------------------------------------------

/** The same sentence the menu bar's one line says, and for the same reason it says it. */
function engineLine(sys) {
  // A missing supervisor REPLACES this: with nothing supervising, what the engine half believes is not the news.
  if (sys.hostError) return `⚠ ${sys.hostError}`;
  if (sys.status === "running")
    return `● Running${sys.ownsEngine ? "" : " (adopted)"} · id ${sys.engineId.slice(0, 8)} · :${sys.enginePort}`;
  if (sys.status === "error") return `⚠ ${sys.error ?? "error"}`;
  return "○ Stopped";
}

function fact(label, value, warn) {
  const node = document.createElement("li");
  node.className = "row";
  node.innerHTML = '<span class="label"></span><span class="value"></span>';
  node.querySelector(".label").textContent = label;
  const v = node.querySelector(".value");
  v.textContent = value;
  if (warn) v.classList.add("warn");
  return node;
}

function renderSystem(sys) {
  const up = sys.status === "running";
  systemList.replaceChildren(
    fact("Version", sys.build),
    fact("Engine", engineLine(sys), !!sys.hostError || sys.status === "error"),
    // No registry is the default, not a fault: a fresh machine is connected to no st0 instance.
    sys.registryUrl
      ? fact(
          "Registry",
          `${sys.registryUrl}${up ? (sys.lastHeartbeatOk ? " · ok" : " · unreachable") : ""}`,
          up && !sys.lastHeartbeatOk,
        )
      : fact("Registry", "none — see st0 instances"),
  );
  adopted.hidden = !(up && !sys.ownsEngine);
  byId("engine-start").disabled = !sys.canStart;
  for (const id of ["engine-stop", "engine-restart"]) byId(id).disabled = !sys.canAct;
}

// --- the sync targets -------------------------------------------------------

/** A file:// folder, checked here only to answer AT ONCE; the supervisor's normaliser is the gate. */
function badUri(uri) {
  let url;
  try {
    url = new URL(uri);
  } catch {
    return "not an address — file:///…";
  }
  // Named rather than ignored: a network box is reached by mounting it, then naming the folder.
  if (url.protocol !== "file:")
    return `${url.protocol.replace(":", "")}:// cannot be copied to — mount it, then give its file:// folder`;
  if (url.hostname && url.hostname !== "localhost")
    return "a file:// address names this machine's own disk";
  if (url.username || url.password) return "a file:// address carries no login";
  return url.pathname && url.pathname !== "/" ? "" : "no folder in that address";
}

/** Send the whole list up, as the audio ranking does: an edit is one act. */
function commitTargets(next) {
  targets = next;
  api?.core.invoke("sync_targets", { targets: next });
}

function buildTarget(t) {
  const node = document.createElement("li");
  node.innerHTML =
    '<div class="row"><span class="body"><span class="name"></span><br />' +
    '<span class="detail"></span></span></div>';
  node.querySelector(".name").textContent = t.name;
  // The URI in full, password included: this window runs ON the machine that holds the file.
  node.querySelector(".detail").textContent = t.uri;
  const drop = document.createElement("button");
  drop.className = "forget";
  drop.type = "button";
  drop.textContent = "Remove";
  drop.addEventListener("click", () =>
    commitTargets(targets.filter((x) => x.name !== t.name)),
  );
  node.querySelector(".row").append(drop);
  return node;
}

function renderSync(rows) {
  targets = rows;
  syncList.replaceChildren(...rows.map(buildTarget));
  syncEmpty.hidden = rows.length > 0;
  syncEmpty.textContent = "No target yet — a playlist can be copied nowhere.";
}

function addTarget() {
  const name = syncName.value.trim();
  const uri = syncUri.value.trim();
  const wrong = !name ? "give it a name" : badUri(uri);
  syncError.textContent = wrong;
  syncError.hidden = !wrong;
  if (wrong) return;
  // The NAME is the identity a playlist screen sends back, so two of one would be ambiguous.
  if (targets.some((t) => t.name === name)) {
    syncError.textContent = `there is already a target called ${name}`;
    syncError.hidden = false;
    return;
  }
  commitTargets([...targets, { name, uri }]);
  syncName.value = "";
  syncUri.value = "";
}

// --- the st0 instances ------------------------------------------------------

/** What the user typed, reduced to an origin the way the supervisor will, or an error sentence. Checked here only
 *  to answer AT ONCE — the supervisor's normaliser is the gate (packages/engine-host/src/instanceUrl.ts). */
function instanceOrigin(input) {
  const raw = input.trim();
  if (!raw) return { error: "type the address of a st0 instance" };
  let url;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return { error: "not an address — https://… or http://…" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { error: `${url.protocol.replace(":", "")}:// is not a web address — https:// or http:// only` };
  if (url.username || url.password) return { error: "no credentials in the address" };
  if (!url.hostname || url.hostname.includes("*")) return { error: "no host in that address" };
  return { origin: url.origin };
}

function instanceDetail(i) {
  const what = "listed in its picker";
  // Said rather than just missing a button: otherwise the row reads as one the window forgot to make removable.
  return i.removable ? what : `${what} · set by STUDIO_REGISTRY_URL`;
}

function buildInstance(i) {
  const node = document.createElement("li");
  node.innerHTML =
    '<div class="row"><span class="body"><span class="name"></span><br />' +
    '<span class="detail"></span></span></div>';
  node.querySelector(".name").textContent = i.url;
  node.querySelector(".detail").textContent = instanceDetail(i);
  if (i.removable) {
    const drop = document.createElement("button");
    drop.className = "forget";
    drop.type = "button";
    drop.textContent = "Remove";
    drop.addEventListener("click", () => api?.core.invoke("instance_remove", { url: i.url }));
    node.querySelector(".row").append(drop);
  }
  return node;
}

/** The form's one line: a local mistake, else what the supervisor said about the last add. */
function paintInstanceError() {
  const checking = instanceCheck?.state === "checking";
  const said = localError
    ? localError
    : checking
      ? `Checking ${instanceCheck.url}…`
      : instanceCheck?.state === "refused"
        ? instanceCheck.message || `${instanceCheck.url} was refused`
        : "";
  instanceError.textContent = said;
  instanceError.hidden = !said;
  instanceError.classList.toggle("warn", !localError && !checking && !!said);
  // One add at a time: a second while the first is being asked would leave the line saying only one of them.
  instanceAdd.disabled = checking;
}

function renderInstances(rows, check) {
  instances = rows;
  instanceCheck = check;
  paintInstanceError();
  instanceList.replaceChildren(...rows.map(buildInstance));
  instancesEmpty.hidden = rows.length > 0;
  instancesEmpty.textContent = "Not connected to any st0 instance.";
}

function addInstance(e) {
  e.preventDefault();
  const { origin, error } = instanceOrigin(instanceUrl.value);
  const known = origin && instances.some((i) => instanceOrigin(i.url).origin === origin);
  localError = error ?? (known ? `already connected to ${origin}` : "");
  paintInstanceError();
  if (localError) return;
  api?.core.invoke("instance_add", { url: origin });
  instanceUrl.value = "";
}

// --- what the tray sends ----------------------------------------------------

function render(view) {
  running = view.engineRunning;
  plugins = view.plugins;
  counted = view.pluginCount;
  // A snapshot arriving mid-drag must never yank the audio list out from under a finger.
  if (!dragging) renderAudio(view.audio);
  renderPlugins();
  renderSessions(view.sessions, view.orphanPlugins);
  renderSync(view.syncTargets);
  renderInstances(view.instances, view.instanceCheck);
  renderSystem(view.system);
}

const byId = (id) => document.getElementById(id);

/** One panel at a time; the buttons ARE the state, so a redraw never disturbs which tab is open. */
for (const tab of document.querySelectorAll('[role="tab"]'))
  tab.addEventListener("click", () => {
    for (const other of document.querySelectorAll('[role="tab"]')) {
      const on = other === tab;
      other.setAttribute("aria-selected", String(on));
      byId(other.dataset.panel).hidden = !on;
    }
  });

for (const [id, cmd] of [
  ["engine-start", "engine_start"],
  ["engine-stop", "engine_stop"],
  ["engine-restart", "engine_restart"],
])
  byId(id).addEventListener("click", () => api?.core.invoke(cmd));

document.addEventListener("pointermove", drag);
document.addEventListener("pointerup", drop);
document.addEventListener("pointercancel", drop);
document.addEventListener("keydown", (e) => {
  if (api && e.key === "Escape") api.core.invoke("settings_close");
});
filter.addEventListener("input", renderPlugins);
syncAdd.addEventListener("click", addTarget);
// Enter in either field adds, the bar being two fields and a button rather than a form.
for (const field of [syncName, syncUri])
  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addTarget();
  });
rescan.addEventListener("click", () => api?.core.invoke("plugins_rescan"));
instanceForm.addEventListener("submit", addInstance);

if (api) {
  api.event.listen("settings:view", (e) => render(e.payload));
  api.core.invoke("settings_view").then(render);
}
