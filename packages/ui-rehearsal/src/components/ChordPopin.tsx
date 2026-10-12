import { Dialog, DialogContent, DialogTitle } from "@frediverse/ui/dialog";
import { ChordDiagram } from "./ChordDiagram";

interface Props {
  symbol: string;
  onClose: () => void;
}

/** Mobile modal shown when a chord is tapped in the sheet. */
export function ChordPopin({ symbol, onClose }: Props) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rehearsal-root w-auto min-w-[220px] p-4 pt-5 sm:max-w-sm">
        {/* The diagram card renders the chord name itself. */}
        <DialogTitle className="sr-only">{symbol}</DialogTitle>
        <div className="[&_.chord-card-svg]:w-[250px]">
          <ChordDiagram key={symbol} symbol={symbol} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
