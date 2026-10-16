// intrinsics.ts — what `node param` writes when the name is not a plugin parameter: a
// module's intrinsic fields, its file-valued params, the master volume. Holds no verbs;
// see packages/song/docs/intrinsics.md.

import { join, relative } from "node:path";
import { libraryFiles } from "@studio/song/libraryFiles";
import { loadModuleRefs, loadModules } from "@studio/song/loader";
import { moduleAssetChoices } from "@studio/song/moduleAssetChoices";
import { deleteFileValue, setFileValue } from "@studio/song/yaml/edit";
import {
  setModuleAsset,
  setModuleBase,
  setModuleCamera,
  setModuleChannel,
  setModuleDevice,
  setModuleInputGain,
  setModuleMix,
  setModuleMonitor,
  setModuleShader,
  setModuleVolume,
} from "@studio/song-edit/projectEdit";
import {
  CUE_NODE,
  isLibraryFileParam,
  LIBRARY_FILE_PARAMS,
  MIX_NODE,
  OUT_NODE,
  RENDER_NODE,
  sharedFamilyOf,
  VIDEO_OUT_NODE,
} from "@studio/song-schema/moduleTypes";
import {
  MASTER_MAX_DB,
  MASTER_MIN_DB,
} from "@studio/song-schema/yaml/projectSchema";
import { climbsOut } from "@studio/web-protocol/paths";
import type { CommandHost } from "../commands.ts";

/** A module's INTRINSICS — its own fields, set as `node param <node> @<field> <value>`; docs/verbs.md. */
const INTRINSICS: Record<
  string,
  (dir: string, module: string, raw: string) => { path: string; said: string }
> = {
  // One channel or two; whether the rig actually groups a pair is the engine's to know — docs/verbs.md.
  channel: (dir, module, raw) => {
    const channels = raw.split(",").map((s) => Number(s.trim()));
    if (channels.some((n) => !Number.isInteger(n) || n < 1))
      throw new Error(`'${raw}' is not a channel or a pair of them`);
    return {
      path: setModuleChannel(dir, module, channels),
      said: `channel ${channels.join(", ")}`,
    };
  },
  monitor: (dir, module, raw) => {
    if (raw !== "off" && raw !== "auto" && raw !== "on")
      throw new Error(`'${raw}' is not off, auto or on`);
    return { path: setModuleMonitor(dir, module, raw), said: `monitor ${raw}` };
  },
  gain: (dir, module, raw) => {
    const db = Number(raw);
    if (!Number.isFinite(db)) throw new Error(`'${raw}' is not a number of dB`);
    return { path: setModuleInputGain(dir, module, db), said: `gain ${db} dB` };
  },
  /** The engine's dry/wet around an effect, 0 all dry .. 1 all wet — engine/k7-runtime/docs/mix.md. */
  mix: (dir, module, raw) => {
    const mix = Number(raw);
    if (!Number.isFinite(mix) || mix < 0 || mix > 1)
      throw new Error(`'${raw}' is not a mix between 0 and 1`);
    return {
      path: setModuleMix(dir, module, mix),
      said: `mix ${Math.round(mix * 100)}% wet`,
    };
  },
  /** The engine's level into and out of the module, in dB — engine/k7-runtime/docs/mix.md. */
  "input-volume": (dir, module, raw) =>
    volumeIntrinsic(dir, module, "input", raw),
  "output-volume": (dir, module, raw) =>
    volumeIntrinsic(dir, module, "output", raw),
  /** Which SHADER a shader node runs; `none` clears it, and nothing is checked against the disk — docs/verbs.md. */
  shader: (dir, module, raw) => {
    const name = raw.trim() === "none" ? "" : raw.trim();
    return {
      path: setModuleShader(dir, module, name),
      said: name ? `shader ${name}` : "no shader",
    };
  },
  /** Which CAMERA a live picture node opens, by its LABEL; `default` clears it — docs/camera.md. */
  camera: (dir, module, raw) => {
    const name = raw.trim() === "default" ? "" : raw.trim();
    return {
      path: setModuleCamera(dir, module, name),
      said: name ? `camera ${name}` : "the default camera",
    };
  },
  /** Which MIDI DEVICE a midi-in node records from, by its LABEL; `any` clears it — packages/song/docs/midiIn.md. */
  device: (dir, module, raw) => {
    const name = raw.trim() === "any" ? "" : raw.trim();
    return {
      path: setModuleDevice(dir, module, name),
      said: name ? `MIDI device ${name}` : "any MIDI device",
    };
  },
  /** Which named BASE this module starts from — the opaque `.vstpreset` under its params; docs/verbs.md. */
  base: (dir, module, raw) => {
    const name = raw.trim() === "none" ? "" : raw.trim();
    return {
      path: setModuleBase(dir, module, name),
      said: name ? `base ${name}` : "no base",
    };
  },
};

/** One of the two volume intrinsics: dB, -60..+12, and 0 is no line. */
function volumeIntrinsic(
  dir: string,
  module: string,
  side: "input" | "output",
  raw: string,
): { path: string; said: string } {
  const db = Number(raw);
  if (!Number.isFinite(db) || db < -60 || db > 12)
    throw new Error(`'${raw}' is not a volume between -60 and +12 dB`);
  return {
    path: setModuleVolume(dir, module, side, db),
    said: `${side} volume ${db > 0 ? "+" : ""}${db} dB`,
  };
}

/** Point a FILE-VALUED param at one of the module's own assets, or clear it with `none` — docs/verbs.md. */
export async function setFileParam(
  h: CommandHost,
  module: string,
  param: string,
  rawFile: string,
): Promise<void> {
  const file = rawFile.replace(/^"(.*)"$/s, "$1").trim();
  const clearing = file === "none";
  // A library's family when the param names one: always for `ir`, by an `@` for `model`; none means no `assets/`.
  const family = isLibraryFileParam(param)
    ? LIBRARY_FILE_PARAMS[param]
    : file.startsWith("@")
      ? sharedFamilyOf(param)
      : null;
  if (!clearing && family) {
    // A library's file, by `@<library>/<path>`: the same list the panel's picker offers (packages/song/docs/libraryFiles.md).
    const shared = libraryFiles(family, h.songPath);
    if (!shared.includes(file)) {
      h.refuse([
        shared.length
          ? `no '${file}' in the libraries' ${family}/ — they have: ${shared.slice(0, 8).join(", ")}${shared.length > 8 ? ", …" : ""}`
          : `no library has a ${family}/ folder with a file in it yet`,
      ]);
      return;
    }
  } else if (!clearing) {
    const found = loadModules(h.songPath)[module];
    // Its own assets AND its ancestors': the same answer the panel's picker offers — docs/verbs.md.
    const have = moduleAssetChoices(
      h.songPath,
      found,
      loadModuleRefs(h.songPath),
    );
    if (!have.includes(file)) {
      h.refuse([
        have.length
          ? `no '${file}' in ${module}'s assets — it has: ${have.join(", ")}`
          : `${module} carries no assets — drop the file in modules/<category>/${found?.file ?? module}/assets/`,
      ]);
      return;
    }
  }
  try {
    setModuleAsset(h.songPath, module, param, clearing ? null : file);
    h.log([`${module}: ${clearing ? `${param} cleared` : file}`]);
    await h.reload();
  } catch (e) {
    h.refuse([`node param ${param} failed: ${(e as Error).message}`]);
  }
}

/** A Faust slot's sound: a library's `wavetables/` or `samples/` file, or `@project/…`, as the picker offers; `none` clears. */
export async function setFaustSound(
  h: CommandHost,
  module: string,
  slot: string,
  file: string,
): Promise<void> {
  const clearing = file === "none";
  if (!clearing && file.startsWith("@")) {
    const offered = [
      ...libraryFiles("wavetables", h.songPath),
      ...libraryFiles("samples", h.songPath),
    ];
    if (!offered.includes(file)) {
      h.refuse([
        `no '${file}' in the libraries' wavetables/ or samples/ — they have: ${offered.slice(0, 8).join(", ") || "nothing yet"}`,
      ]);
      return;
    }
  }
  try {
    setModuleAsset(h.songPath, module, slot, clearing ? null : file);
    h.log([`${module}: ${slot} ${clearing ? "cleared" : `plays ${file}`}`]);
    await h.reload();
  } catch (e) {
    h.refuse([`node param ${slot} failed: ${(e as Error).message}`]);
  }
}

/** Write one intrinsic and say where it landed — the file may be the workspace's SHARED one; docs/verbs.md. */
export async function setIntrinsic(
  h: CommandHost,
  module: string,
  field: string,
  raw: string,
): Promise<void> {
  const write = INTRINSICS[field];
  if (!write) {
    h.refuse([
      `no intrinsic '@${field}' — a module's own fields are ${Object.keys(
        INTRINSICS,
      )
        .map((f) => `@${f}`)
        .join(", ")}`,
    ]);
    return;
  }
  try {
    const { path, said } = write(h.songPath, module, raw);
    h.log([
      `${module}: ${said}` +
        (climbsOut(relative(h.songPath, path))
          ? " — in the shared library, so every project beside this one sees it"
          : ""),
    ]);
    await h.reload();
  } catch (e) {
    h.refuse([`node param @${field} failed: ${(e as Error).message}`]);
  }
}

/** The OUT node's one parameter, written to `project.masterVolume`; unity is NOT written — packages/song/docs/masterVolume.md. */
export async function writeMasterVolume(
  h: CommandHost,
  db: number,
): Promise<boolean> {
  if (db > MASTER_MAX_DB || db < MASTER_MIN_DB) {
    h.refuse([
      `${db} dB is outside the fader — it runs ${MASTER_MIN_DB}..+${MASTER_MAX_DB} dB`,
      ...(db > MASTER_MAX_DB
        ? [
            "a mix that needs more than +12 on its output has its headroom in the STRIPS — see packages/song/docs/masterVolume.md",
          ]
        : []),
    ]);
    return false;
  }
  const file = join(h.songPath, "project.yaml");
  if (db === 0) deleteFileValue(file, ["project", "masterVolume"]);
  else setFileValue(file, ["project", "masterVolume"], db);
  await h.applyProject({ ...h.project(), masterVolume: db });
  return true;
}

/** `node param` on one of the five built-in outputs; only `OUT` carries one, the rest refuse BY NAME — docs/verbs.md. */
export async function setBuiltinOutParam(
  h: CommandHost,
  node: string,
  param: string,
  value: number,
): Promise<void> {
  if (node === MIX_NODE) {
    h.refuse([
      `${MIX_NODE} is the mixer's sum and carries no level — the output level is ${OUT_NODE}'s`,
      `try: node param "${OUT_NODE}" Volume ${value}`,
    ]);
    return;
  }
  if (node === RENDER_NODE || node === VIDEO_OUT_NODE) {
    h.refuse([
      `${node} carries no param — the picture's outputs are routing only, and a frame has no level`,
      `the one built-in param is ${OUT_NODE}'s Volume, the song's output level in dB`,
    ]);
    return;
  }
  if (node === CUE_NODE) {
    // A headphone amp has its own knob, and what each feed contributes is the module on its way in.
    h.refuse([
      `${CUE_NODE} carries no level — it is the pair the headphones are plugged into, and that amp has its own knob`,
      `set what a feed CONTRIBUTES instead, on the module wired into ${CUE_NODE}`,
    ]);
    return;
  }
  if (param !== "Volume") {
    h.refuse([
      `${OUT_NODE} has one param, Volume — the song's output level in dB`,
    ]);
    return;
  }
  if (await writeMasterVolume(h, value))
    h.log([`${OUT_NODE}: Volume = ${value}`]);
}
