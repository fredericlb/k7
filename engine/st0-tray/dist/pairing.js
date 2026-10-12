// pairing.js — the Paired devices tab: LAN devices asking to drive this engine, and those it already trusts.
// The supervisor relays the engine's lists and this page sends approve, deny or revoke back; the KEY a device
// receives never passes through here. Loaded before settings.js, whose render() calls renderPairing.

const pairRequestList = document.getElementById("pair-requests");
const pairRequestsEmpty = document.getElementById("pair-requests-empty");
const pairedList = document.getElementById("paired-devices");
const pairedEmpty = document.getElementById("paired-devices-empty");
const pairingTab = document.getElementById("tab-pairing");

/** "just now", "5 min ago", "3 h ago", else the date: how stale a device is, at a glance. */
function ago(ms) {
  if (!ms) return "never";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

function pairButton(label, command, args, forget) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (forget) button.className = "forget";
  button.addEventListener("click", () => {
    button.disabled = true;
    api?.core.invoke(command, args);
  });
  return button;
}

function buildPairRequest(r) {
  const node = document.createElement("li");
  node.innerHTML =
    '<div class="row"><span class="body"><span class="name"></span><br />' +
    '<span class="pair-code"></span><br /><span class="detail"></span></span></div>';
  node.querySelector(".name").textContent = r.name || "unnamed device";
  node.querySelector(".pair-code").textContent = r.code;
  node.querySelector(".detail").textContent = `from ${r.ip} · asked ${ago(r.since)}`;
  node
    .querySelector(".row")
    .append(
      pairButton("Approve", "pair_approve", { requestId: r.requestId }, false),
      pairButton("Deny", "pair_deny", { requestId: r.requestId }, true),
    );
  return node;
}

function buildPairedDevice(d) {
  const node = document.createElement("li");
  node.innerHTML =
    '<div class="row"><span class="body"><span class="name"></span><br />' +
    '<span class="detail"></span></span></div>';
  node.querySelector(".name").textContent = d.name || "unnamed device";
  node.querySelector(".detail").textContent =
    `last seen ${ago(d.lastSeen)} · paired ${new Date(d.created).toLocaleDateString()}`;
  node.querySelector(".row").append(pairButton("Revoke", "pair_revoke", { deviceId: d.deviceId }, true));
  return node;
}

function renderPairing(requests, devices) {
  pairRequestList.replaceChildren(...requests.map(buildPairRequest));
  pairRequestsEmpty.hidden = requests.length > 0;
  pairRequestsEmpty.textContent = running
    ? "No device is asking."
    : "Start the engine to see devices asking to pair.";
  pairedList.replaceChildren(...devices.map(buildPairedDevice));
  pairedEmpty.hidden = devices.length > 0;
  pairedEmpty.textContent = "No device is paired with this engine.";
  // The tab says a request waits, so "Open Settings" from the notification lands one click away.
  pairingTab.textContent = requests.length ? `Paired devices (${requests.length})` : "Paired devices";
}
