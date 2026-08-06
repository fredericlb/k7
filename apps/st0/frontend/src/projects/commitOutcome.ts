// commitOutcome.ts — lire la réponse de `project commit` comme un RÉSULTAT. Pur et à part :
// c'est exactement la logique qui a annoncé un succès pour un commit qui n'avait pas eu lieu,
// et un module qui n'importe rien est un module qu'un test peut charger. Voir ./machine.ts.

/**
 * Ce que la commande a répondu, lu comme un RÉSULTAT : `null` si le commit est passé, sinon la
 * plainte.
 *
 * Il faut une preuve POSITIVE de succès, et c'est le fond du bug qu'a eu cette fonction : sa
 * première version cherchait des mots d'échec connus et rendait `null` pour tout le reste. Le
 * verbe était faux (`commit` au lieu de `project commit`), la commande répondait « unknown
 * command », et l'écran annonçait un succès. Un projet créé n'était ni committé ni poussé, sans
 * un mot.
 *
 * Les lignes viennent de `project.commit` dans packages/commands/src/commands.ts.
 */
export function commitOutcome(out: string[]): string | null {
  if (out.some((l) => l.startsWith("committed ")))
    // Un push raté n'est pas un commit raté : le dire distinctement, parce que ça se rattrape
    // en poussant plus tard et non en recommençant.
    return out.find((l) => l.startsWith("push failed")) ?? null;
  if (out.some((l) => l.startsWith("nothing to commit")))
    return "rien à committer — le dossier est-il ignoré par git ?";
  // Tout le reste est un échec, y compris ce qu'on ne reconnaît pas : la sortie brute vaut
  // mieux qu'un silence, et c'est elle qui nommera la prochaine dérive.
  return out.join(" · ").trim() || "la commande n'a rien répondu";
}
