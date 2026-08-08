// InputMeter.tsx — ce que l'entrée monitorée est en train de faire, en dB. Le seul retour
// visuel qui dise si la guitare arrive AVANT le module : un panneau muet et un panneau
// débranché se ressemblent. Voir ../../docs/modulePreview.md.

/** Le bas de l'échelle. -60 dB et non -100 : sous ça il n'y a rien à régler, et étaler
 *  quarante dB de silence écrase la partie où le geste compte. */
const FLOOR = -60;
/** Le haut. 0 dBFS est l'écrêtage — au-delà, il n'y a plus de marge à montrer. */
const CEIL = 0;

/** La position d'un niveau sur la jauge, 0..1. Exportée parce que c'est la seule chose ici
 *  qui puisse être fausse en silence. */
export function meterFill(db: number): number {
  if (!Number.isFinite(db)) return 0;
  const t = (db - FLOOR) / (CEIL - FLOOR);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Le niveau écrit, ou "—" quand il n'y a rien. Le moteur envoie -100 aussi bien pour
 *  « silence » que pour « aucune entrée assignée » : les deux se lisent pareil, et c'est
 *  honnête — l'un comme l'autre veut dire qu'il n'y a rien à entendre. */
export function meterLabel(db: number): string {
  return Number.isFinite(db) && db > FLOOR ? `${db.toFixed(0)} dB` : "—";
}

export function InputMeter({ db }: { db: number }) {
  const fill = meterFill(db);
  return (
    <span
      className="flex items-center gap-1"
      title={`Niveau de l'entrée monitorée : ${meterLabel(db)}`}
    >
      <span className="relative block h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-75"
          style={{ width: `${fill * 100}%` }}
        />
        {/* Le repère des -6 dB : la marge qu'on garde avant l'écrêtage, et le seul point de
            cette échelle qu'on vise vraiment en réglant un préampli. */}
        <span
          className="absolute inset-y-0 w-px bg-border"
          style={{ left: `${meterFill(-6) * 100}%` }}
        />
      </span>
      <span className="w-12 font-mono tabular-nums">{meterLabel(db)}</span>
    </span>
  );
}
