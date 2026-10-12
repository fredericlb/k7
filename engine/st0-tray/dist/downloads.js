// downloads.js — the Downloads tab: every instrument the engine can play, and the one button that fits where
// it stands. Nothing is fetched until it is asked for here; the supervisor queues, fetches and deletes, and
// this page only draws the snapshot it echoes. Loaded before settings.js, whose render() calls renderInstruments.

const instrumentList = document.getElementById("instruments");
const instrumentsEmpty = document.getElementById("instruments-empty");

/** "748 MB", "1.3 GB": the size the list pins, which is what the download will cost. */
function size(bytes) {
  const mb = bytes / 1e6;
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.max(1, Math.round(mb))} MB`;
}

/** What the row says under the name. */
function instrumentDetail(i) {
  const of = size(i.bytes);
  if (i.phase === "queued") return `waiting for the download before it · ${of}`;
  if (i.phase === "downloading") {
    const pct = i.bytes > 0 ? Math.min(100, Math.floor((i.received * 100) / i.bytes)) : 0;
    return `downloading ${pct}% of ${of}`;
  }
  if (i.phase === "unpacking") return `unpacking · ${of}`;
  if (i.phase === "failed") return `download failed: ${i.error || "no reason given"}`;
  if (i.installed) return `installed · ${of}`;
  return i.wanted ? `not downloaded yet · ${of}` : of;
}

/** The row's one action, or none while a download runs: the supervisor cannot cut one mid-file. */
function instrumentAction(i) {
  if (i.phase === "downloading" || i.phase === "unpacking") return null;
  if (i.phase === "queued") return ["Cancel", "instrument_remove"];
  if (i.phase === "failed") return ["Retry", "instrument_download"];
  if (i.installed) return ["Remove", "instrument_remove"];
  return ["Download", "instrument_download"];
}

function buildInstrument(i) {
  const node = document.createElement("li");
  node.innerHTML =
    '<div class="row"><span class="body"><span class="name"></span><br />' +
    '<span class="detail"></span></span></div>';
  node.querySelector(".name").textContent = i.label;
  const detail = node.querySelector(".detail");
  detail.textContent = instrumentDetail(i);
  if (i.phase === "failed") detail.classList.add("warn");
  if (i.phase === "downloading") {
    const bar = document.createElement("progress");
    bar.max = i.bytes || 1;
    bar.value = i.received;
    node.querySelector(".body").append(bar);
  }
  const action = instrumentAction(i);
  if (action) {
    const [label, command] = action;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    // Removing deletes files; the other actions only cost bandwidth.
    if (command === "instrument_remove") button.className = "forget";
    button.addEventListener("click", () => {
      button.disabled = true;
      api?.core.invoke(command, { name: i.name });
    });
    node.querySelector(".row").append(button);
  }
  return node;
}

function renderInstruments(rows) {
  instrumentList.replaceChildren(...rows.map(buildInstrument));
  instrumentsEmpty.hidden = rows.length > 0;
  instrumentsEmpty.textContent = "The supervisor has not listed its instruments yet.";
}
