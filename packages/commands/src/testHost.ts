// testHost.ts — un `CommandHost` COMPLET pour un test, dont on ne renseigne que ce qui compte.
//
// Les suites de ce paquet fabriquaient chacune leur hôte et le finissaient par `as never` : 128
// occurrences dans l'arbre, et chacune éteint le typeur sur l'objet qu'elle vient d'écrire. Deux
// conséquences, vues toutes les deux :
//
//   • un hôte à qui il manque un champ que le verbe appelle passe la compilation et casse à
//     l'exécution, dans un test qui ne parle pas de ça ;
//   • un champ OPTIONNEL renseigné à `undefined` prend la valeur par défaut du paramètre, donc le
//     test « sans cette capacité » exerce en fait un hôte qui l'a. Ça a coûté deux faux verts.
//
// Ici l'objet est complet par construction et l'appelant ne dit que ce qu'il veut changer. Il n'y
// a plus de cast, donc oublier un champ que le verbe appelle est une erreur de compilation.

import type {
  AudioDeviceInfo,
  PluginInfo,
} from "@studio/engine-client/engineClient";
import type { ProjectDoc } from "@studio/song/project";
import type { CommandHost } from "./commands.ts";

/** Ce qu'un test lit après coup : les lignes des deux canaux, séparées comme le verbe les sépare. */
export interface HostLog {
  log: string[];
  refuse: string[];
}

/**
 * Un hôte complet, plus ce que le test veut changer.
 *
 * Les défauts sont INERTES, jamais des espions : ils ne renvoient rien et n'écrivent rien, donc un
 * verbe qui atteint une capacité que le test n'a pas nommée ne fait rien de visible plutôt que de
 * casser. Ce qui compte, ce sont les deux canaux, qui reviennent dans `lines`.
 *
 * Un projet vide par défaut : c'est ce que la plupart des refus exercent, et un test qui a besoin
 * de pistes passe le sien.
 */
export function testHost(
  over: Partial<CommandHost> = {},
): CommandHost & { lines: HostLog } {
  const lines: HostLog = { log: [], refuse: [] };
  const host: CommandHost & { lines: HostLog } = {
    lines,
    songPath: "",
    project: () => ({ tracks: [] }) as unknown as ProjectDoc,
    baseModules: [],
    log: (l) => lines.log.push(...l),
    refuse: (l) => lines.refuse.push(...l),
    reload: () => {},
    transport: () => {},
    arm: async () => undefined,
    applyProject: () => {},
    sendProject: () => {},
    listPlugins: () => {},
    rescanPlugins: () => {},
    showNativePluginUI: () => {},
    getPlugins: async () => [] as PluginInfo[],
    getAudioDevices: async () => [] as AudioDeviceInfo[],
    ...over,
  };
  return host;
}
