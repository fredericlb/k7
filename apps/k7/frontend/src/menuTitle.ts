// menuTitle.ts — the row at the top of a right-click menu naming what it is ON: the entity, as
// `commands.yaml`'s `menu:` calls it, and the thing's shown name — a lane by its label, a clip by
// its shown name, never a generated id when a name exists. Pure: the namers are passed in.
// See docs/contextMenu.md, "The title row".

import { CTX_ENTITY, type MenuCtx } from "./contextMenu";
import { noteName } from "./noteNames";
import type { MenuEntity } from "./types";

/** What a menu is on: the kind of thing, and the name it is shown by. */
export interface MenuTarget {
  entity: MenuEntity;
  name: string;
}

/** How ids read as names — the host's lanes and clips; absent, an id reads as itself. */
export interface MenuNamers {
  lane?: (id: string) => string;
  clip?: (ref: string) => string;
}

/** The target of a context's menu, or null for one that names nothing (a chain, a sink). */
export function menuTarget(
  ctx: MenuCtx,
  names: MenuNamers = {},
): MenuTarget | null {
  const entity = CTX_ENTITY[ctx.kind];
  if (!entity) return null;
  const lane = names.lane ?? ((id: string) => id);
  const clip = names.clip ?? ((ref: string) => ref);
  const name = ((): string => {
    switch (ctx.kind) {
      case "track":
        return lane(ctx.id);
      case "clip":
        return clip(ctx.id);
      case "param":
        return ctx.label || ctx.param;
      case "curve-point":
        return ctx.param || ctx.curve;
      case "curve-card":
        return ctx.param ?? ctx.curve;
      case "marker-add":
        return ctx.tc;
      case "marker":
        return ctx.name;
      case "warp-point":
        return ctx.src;
      case "picture-shot":
        return ctx.name || ctx.at;
      case "picture-lane":
        return lane(ctx.lane);
      case "pad":
      case "note":
        return `${noteName(ctx.note)} · ${clip(ctx.sequence)}`;
      case "tap":
        return `${ctx.symbol} · ${ctx.id}`;
      default:
        return "id" in ctx ? ctx.id : "";
    }
  })();
  return { entity, name };
}
