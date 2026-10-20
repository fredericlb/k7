// nodeParam.ts — a node's values: `node param`, a MIDI CC bound to a module, and
// `node automate`. See docs/verbs.md.

import { bindModuleCc } from "@studio/song/controllerBind";
import { isFileParam } from "@studio/song/loader";
import {
  setModuleAutomationBinding,
  setModuleParam,
} from "@studio/song-edit/projectEdit";
import { builtinParamAutomatable } from "@studio/song-schema/builtinParams";
import {
  curveRef,
  isBuiltinOutput,
  isLibraryFileParam,
} from "@studio/song-schema/moduleTypes";
import type { SidHandler } from "../commands.ts";
import {
  setBuiltinOutParam,
  setFaustSound,
  setFileParam,
  setIntrinsic,
} from "./intrinsics.ts";
import { collectPluginModules, mapPlugins } from "./node.ts";
import { splitWords } from "./shared.ts";

export const NODE_PARAM_VERBS: Record<string, SidHandler> = {
  /** node param <node> <param> <value> — node, param and value may each be quoted; docs/verbs.md. */
  "node.param": async (a, h) => {
    // An `@field` is one word, so its value is the REST — a device or a lens is named with spaces.
    const m =
      /^("[^"]*"|\S+)\s+(@\S+)\s+(.+)$/.exec(a.trim()) ??
      /^("[^"]*"|\S+)\s+("[^"]*"|.+?)\s+("[^"]*"|\S+)$/.exec(a.trim());
    if (!m) {
      h.refuse([
        'usage: node param <node> <param> <value>  (e.g. node param synth "Filter Freq" 69)',
      ]);
      return;
    }
    const [, rawModule, rawParam, quotedValue] = m;
    const unquote = (s: string) => s.replace(/^"(.*)"$/s, "$1").trim();
    const module = unquote(rawModule);
    const param = unquote(rawParam);
    // Unquoted for EVERY branch below, not just the file one: `Number('"5"')` is NaN.
    const rawValue = unquote(quotedValue);
    // An INTRINSIC — the module's own field rather than a plugin's parameter; packages/song/docs/intrinsics.md.
    if (param.startsWith("@")) {
      await setIntrinsic(h, module, param.slice(1), rawValue);
      return;
    }
    // …and a FILE-valued one (`model`, `onnx`), whose value is a filename read at BUILD time — setFileParam.
    if (isFileParam(param) || isLibraryFileParam(param)) {
      await setFileParam(h, module, param, rawValue);
      return;
    }
    // …and a FAUST module's sound slot: a Faust knob is always a number, so a string there names a file (docs/verbs.md).
    if (
      !Number.isFinite(Number(rawValue)) &&
      collectPluginModules(h.project()).find((b) => b.module === module)
        ?.type === "Faust"
    ) {
      await setFaustSound(h, module, param, rawValue);
      return;
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      h.refuse([`"${rawValue}" is not a number — a param value is numeric`]);
      return;
    }
    // …and one of the four BUILT-IN outputs, answered before the lookup below would misreport it.
    if (isBuiltinOutput(module)) {
      await setBuiltinOutParam(h, module, param, value);
      return;
    }
    const p = h.project();
    const modules = collectPluginModules(p);
    const matches = modules.filter((b) => b.module === module);
    if (!matches.length) {
      h.refuse([
        `no plugin module '${module}'${modules.length ? ` — try: ${[...new Set(modules.map((b) => b.module))].join(", ")}` : ""}`,
      ]);
      return;
    }
    try {
      // Write the file first — it is the source of truth — then patch the engine in place with one PluginParamChanged.
      setModuleParam(h.songPath, module, param, value);
      // One module in two chains is TWO PluginDocs, so patch every one: the first alone leaves the other stale.
      const np = mapPlugins(p, (pl) =>
        matches.some((x) => x.id === pl.id)
          ? { ...pl, params: { ...pl.params, [param]: value } }
          : pl,
      );
      await h.applyProject(np);
      h.log([`${module}: ${param} = ${value}`]);
    } catch (e) {
      h.refuse([`node param failed: ${(e as Error).message}`]);
    }
  },
  // module cc <module> <param> <channel> <cc> — bind a MIDI control, or `none` to unbind; docs/verbs.md.
  "module.cc": async (a, h) => {
    const usage =
      "usage: module cc <module> <param> <channel 1-16> <cc 0-127>  (e.g. module cc synth Cutoff 1 74)\n" +
      "       module cc <module> <param> none            — unbind";
    const trimmed = a.trim();
    const unbind = /^(\S+)\s+(.+?)\s+none$/i.exec(trimmed);
    const bind = /^(\S+)\s+(.+?)\s+(\d+)\s+(\d+)$/.exec(trimmed);
    const m = unbind ?? bind;
    if (!m) {
      h.refuse([usage]);
      return;
    }
    const module = m[1];
    const param = m[2].replace(/^"(.*)"$/s, "$1").trim();
    const binding = unbind ? null : { ch: Number(m[3]), cc: Number(m[4]) };
    if (binding && (binding.ch < 1 || binding.ch > 16)) {
      h.refuse([`channel ${binding.ch} is not 1-16`, usage]);
      return;
    }
    if (binding && (binding.cc < 0 || binding.cc > 127)) {
      h.refuse([`cc ${binding.cc} is not 0-127`, usage]);
      return;
    }
    try {
      const { rel, ref } = bindModuleCc(h.songPath, module, param, binding);
      h.log([
        binding
          ? `${module}: ${param} <- ch${binding.ch} cc${binding.cc}  (${rel})`
          : `${module}: ${param} unbound  (${rel})`,
        // The map is the MODULE's, so it plays for every use of it.
        `${ref}'s map — shared by every node of it`,
      ]);
    } catch (e) {
      h.refuse([`module cc failed: ${(e as Error).message}`]);
    }
  },
  /** node automate <module> <param> <curve> [trigger] — point a parameter at a curve; `none` unbinds, docs/verbs.md. */
  "node.automate": async (a, h) => {
    const parts = splitWords(a);
    if (parts.length < 3) {
      h.refuse([
        "usage: node automate <module> <param> <curve> [trigger]",
        "       (e.g. node automate osc Filter Freq sweep)",
      ]);
      return;
    }
    const module = parts[0];
    // The last word is the curve unless the one before it is ALSO a known module — that is a trigger.
    const known = new Set(
      collectPluginModules(h.project()).map((b) => b.module),
    );
    const hasTrigger = parts.length >= 4 && known.has(parts[parts.length - 1]);
    const trigger = hasTrigger ? parts[parts.length - 1] : undefined;
    const curve = parts[parts.length - (hasTrigger ? 2 : 1)];
    const param = parts.slice(1, parts.length - (hasTrigger ? 2 : 1)).join(" ");
    if (!param) {
      h.refuse([
        "node automate: no parameter named between the module and the curve",
      ]);
      return;
    }
    // A built-in's plain-state control takes a value but no curve, so binding one is refused here rather than ignored by the engine.
    const target = collectPluginModules(h.project()).find(
      (b) => b.module === module,
    );
    if (
      curve !== "none" &&
      target &&
      !builtinParamAutomatable(target.type, param)
    ) {
      h.refuse([
        `node automate: ${target.type}'s '${param}' cannot be automated — the plugin keeps it as plain state; pick an engine whose knobs automate`,
      ]);
      return;
    }
    try {
      const path = setModuleAutomationBinding(
        h.songPath,
        module,
        param,
        curve === "none" ? null : curveRef(curve),
        trigger,
      );
      await h.reload();
      h.log([
        curve === "none"
          ? `${module}: ${param} is no longer automated (${path})`
          : `${module}: ${param} <- ${curve}${trigger ? `, fired by ${trigger}` : ""}`,
      ]);
    } catch (e) {
      h.refuse([`node automate: ${(e as Error).message}`]);
    }
  },
};
