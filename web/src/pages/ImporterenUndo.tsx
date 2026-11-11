// The confirmation of an undo (phase 0.5-5): what goes is counted by the server first, then the user confirms.
// Design: finance-mockup/js/screens/importeren.js (undoDialog); spec: analysis/screens/importeren.md.
import { useEffect, useState } from 'react';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { api, errorMessage, isAbort } from '../lib/api';
import { sourceLabel, type ImportBatch, type UndoPreview } from '../lib/imports';

const num = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const plural = (n: number, one: string, many: string) => num(n) + ' ' + (n === 1 ? one : many);

interface UndoProps {
  /** The batches that still stand, of one file import: the first one names the run to the server. */
  batches: ImportBatch[];
  /** "je Zichtrekening" or "3 rekeningen". */
  where: string;
  onClose: () => void;
  /** The undo went through; `removed` transactions are gone. */
  onDone: (removed: number) => void;
}

export function UndoDialog({ batches, where, onClose, onDone }: UndoProps) {
  const { online } = useApp();
  const first = batches[0];
  const [preview, setPreview] = useState<UndoPreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    setPreview(null);
    setError('');
    api.undoPreview(first.id, ctl.signal).then(setPreview, (e) => {
      if (!isAbort(e)) setError(errorMessage(e));
    });
    return () => ctl.abort();
  }, [first.id, tries]);

  const confirm = () => {
    if (!online || busy || !preview) return;
    setBusy(true);
    setError('');
    api.undoImport(first.id).then(
      (r) => onDone(r.removed),
      (e) => {
        setError(errorMessage(e));
        setBusy(false);
      },
    );
  };

  return (
    <Sheet onClose={onClose} labelledBy="im-undo-h" className="im-sheet">
      <div className="im-dlg">
        <div className="im-dlg-head">
          <span className="im-dlg-icon im-dlg-icon--neg" aria-hidden="true">
            <Icon name="undo" size={20} stroke={2.2} />
          </span>
          <h2 id="im-undo-h">{batches.length > 1 ? 'Import ongedaan maken?' : 'Batch ' + first.id + ' ongedaan maken?'}</h2>
          <button type="button" className="im-close" aria-label="Sluiten" onClick={onClose}>
            <Icon name="close" size={18} stroke={2.4} />
          </button>
        </div>
        {preview ? (
          <>
            <p>
              <strong>{plural(preview.rows, 'transactie wordt', 'transacties worden')} verwijderd</strong> uit {where}, inclusief hun categorie, splitsingen en notities.{' '}
              {preview.changed > 0 ? num(preview.changed) + ' daarvan heb je zelf aangepast.' : 'Je hebt er geen zelf aangepast.'}
            </p>
            <p>
              Categorieën die bij het importeren zijn aangemaakt en categorieën die op bestaande transacties zijn overgenomen, blijven staan. Andere transacties ook.
            </p>
            <p className="im-help">De koppeling voor {sourceLabel(first.source)} blijft bewaard. Je kan het bestand later opnieuw importeren.</p>
          </>
        ) : (
          !error && (
            <p className="im-help">
              <span className="im-spin" aria-hidden="true" /> Even tellen wat er verdwijnt…
            </p>
          )
        )}
        {error && (
          <div className="im-error" role="alert">
            <Icon name="warning" size={18} stroke={2.2} />
            <div className="im-error-main">
              <p>{error}</p>
              {!preview && (
                <div className="im-error-actions">
                  <button type="button" className="im-btn im-btn--ghost im-btn--sm" onClick={() => setTries((n) => n + 1)}>
                    <Icon name="sync" size={15} stroke={2.2} />
                    Opnieuw proberen
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {!online && (
          <p className="im-off">
            <Icon name="cloudOff" size={16} stroke={2.2} />
            <span>
              <strong>Je bent offline.</strong> Ongedaan maken kan weer zodra je verbinding hebt.
            </span>
          </p>
        )}
        <div className="im-dlg-actions">
          <button type="button" className="im-btn im-btn--ghost" onClick={onClose}>
            Annuleren
          </button>
          <button type="button" className="im-btn im-btn--neg" disabled={!online || busy || !preview} aria-busy={busy || undefined} onClick={confirm}>
            Ongedaan maken
          </button>
        </div>
      </div>
    </Sheet>
  );
}
