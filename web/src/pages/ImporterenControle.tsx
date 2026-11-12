// The Controle step of a Bilance import (phase 0.5-4): the cutoff per account and the probable duplicates side by side.
// Design: finance-mockup/js/screens/importeren.js (step 4: Importgrens card, Waarschijnlijke dubbels); spec:
// analysis/screens/importeren.md. The server decides what is a probable duplicate and where the suggested cutoff lies;
// this file shows them and keeps the user's choices (which lines to import anyway, a date or none per account).
import { useId, useState } from 'react';
import { Icon } from '../components/Icon';
import { delay } from '../components/ui';
import { catColours } from '../lib/categories';
import { categoryIcon } from '../lib/categoryIcons';
import { dateFull, dateShort, eur } from '../lib/format';
import type { CategoryRef, ProbableDuplicate } from '../lib/imports';
import type { Account, CategoryColour } from '../lib/types';

const num = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const plural = (n: number, one: string, many: string) => num(n) + ' ' + (n === 1 ? one : many);
const shortDate = (d: string) => dateShort(d) + ' ' + d.slice(0, 4);
const FIRST_LIST = 4;

interface CutoffProps {
  /** The account the rows go to. */
  account: Account | undefined;
  /** Its first synced booking date: the suggestion; null when it syncs nothing. */
  suggested: string | null;
  /** The cutoff now (rows dated on or after it are skipped); null for none. */
  value: string | null;
  /** The name goes in the title when the file goes to several accounts. */
  named: boolean;
  onChange: (v: string | null) => void;
}

/** The cutoff of one account: a date, the suggestion back, or no cutoff at all. */
export function CutoffCard({ account, suggested, value, named, onChange }: CutoffProps) {
  const id = useId();
  const name = account?.name ?? 'rekening';
  const before = value !== null && suggested !== null && value < suggested;
  const after = value !== null && suggested !== null && value > suggested;
  return (
    <section className="im-card im-cut anim-in" style={delay(60)} aria-labelledby={id + 'h'}>
      <div className="im-cut-head">
        <span className="im-tile" style={{ background: 'var(--soft)', color: 'var(--greenText)' }} aria-hidden="true">
          <Icon name="calendar" size={18} stroke={2} />
        </span>
        <div>
          <h3 className="im-card-title" id={id + 'h'}>
            Afkapdatum{named ? ' · ' + name : ''}
          </h3>
          <p className="im-cut-text">
            {suggested
              ? 'Je ' + name + ' wordt gesynchroniseerd sinds ' + dateFull(suggested) + '. We importeren alleen wat daarvoor ligt: rijen vanaf de afkapdatum worden overgeslagen.'
              : 'Je ' + name + ' wordt niet gesynchroniseerd. Er is dus niets om mee te overlappen, en je hoeft geen afkapdatum te kiezen.'}
          </p>
        </div>
      </div>
      <div className="im-cut-field">
        <div className="field">
          <label className="field-label" htmlFor={id}>
            Afkapdatum{named ? ' voor ' + name : ''}
          </label>
          <input className="input im-date" type="date" id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />
        </div>
        {suggested !== null && value === suggested && <span className="im-badge im-badge--ok">Voorstel</span>}
        {suggested !== null && value !== suggested && (
          <button type="button" className="im-link" onClick={() => onChange(suggested)}>
            Terug naar {dateFull(suggested)}
          </button>
        )}
        {value !== null && (
          <button type="button" className="im-link" onClick={() => onChange(null)}>
            Geen afkapdatum
          </button>
        )}
      </div>
      {suggested !== null && value === null && (
        <div className="im-notice im-notice--warn" role="status">
          <Icon name="warning" size={18} stroke={2.2} />
          <div>Zonder afkapdatum kunnen rijen van na {dateFull(suggested)} dubbel zijn met wat de bank al bracht. Wat Saldo herkent, staat hieronder.</div>
        </div>
      )}
      {after && (
        <div className="im-notice im-notice--warn" role="status">
          <Icon name="warning" size={18} stroke={2.2} />
          <div>Vanaf {dateFull(suggested!)} komen je transacties al van de bank. Rijen tot {dateFull(value!)} kunnen dubbel zijn; Saldo zoekt ze hieronder op.</div>
        </div>
      )}
      {before && (
        <div className="im-notice im-notice--warn" role="status">
          <Icon name="warning" size={18} stroke={2.2} />
          <div>
            De rijen van {dateFull(value!)} tot {dateFull(suggested!)} komen niet van de bank. Met deze afkapdatum ontbreken ze in Saldo.
          </div>
        </div>
      )}
    </section>
  );
}

function CatText({ c }: { c: CategoryRef }) {
  const { bg, fg } = catColours(c.colour as CategoryColour);
  return (
    <span className="im-dup-catname">
      <span className="im-opt-ico" style={{ background: bg, color: fg }} aria-hidden="true">
        <Icon name={categoryIcon(c.icon)} size={12} stroke={2.4} />
      </span>
      {c.name}
    </span>
  );
}

function DuplicateRow({ d, included, onToggle }: { d: ProbableDuplicate; included: boolean; onToggle: () => void }) {
  const gap = Math.round(Math.abs(new Date(d.date).getTime() - new Date(d.existing.date).getTime()) / 86400000);
  const same = d.counterparty.toLowerCase() === d.existing.counterparty.toLowerCase();
  const source = d.source[0] || d.source[1] ? [d.source[0], d.source[1]].filter(Boolean).join(' › ') : 'Zonder categorie';
  const gets = d.takes && !included && d.category;
  return (
    <div className={'im-dup' + (included ? ' is-forced' : '')}>
      <div className="im-dup-side">
        <span className="im-dup-tag">In het bestand</span>
        <span className="im-dup-line">
          <span className="im-dup-date">{shortDate(d.date)}</span>
          <span className="im-dup-name">{d.counterparty}</span>
          <span className="im-dup-amt mono">{eur(d.amount, d.amount > 0)}</span>
        </span>
        <span className="im-dup-cat">{source}</span>
      </div>
      <span className="im-dup-eq" aria-hidden="true">
        ≈
      </span>
      <div className="im-dup-side">
        <span className="im-dup-tag">Al in Saldo · {d.existing.imported ? 'uit een import' : 'van de bank'}</span>
        <span className="im-dup-line">
          <span className="im-dup-date">{shortDate(d.existing.date)}</span>
          <span className="im-dup-name">{d.existing.counterparty}</span>
          <span className="im-dup-amt mono">{eur(d.existing.amount, d.existing.amount > 0)}</span>
        </span>
        <span className="im-dup-cat">
          {d.existing.category ? (
            <CatText c={d.existing.category} />
          ) : (
            <>
              <span className="im-dup-uncat">Niet gecategoriseerd</span>
              {gets && (
                <span className="im-dup-gets">
                  <Icon name="chevron" size={12} stroke={2.4} />
                  krijgt {d.category!.name}
                </span>
              )}
            </>
          )}
        </span>
      </div>
      <div className="im-dup-foot">
        <span className="im-dup-why">{[gap === 0 ? 'zelfde dag' : '1 dag verschil', 'zelfde bedrag', same ? 'zelfde naam' : 'naam lijkt erop'].join(' · ')}</span>
        <button type="button" className="im-force" aria-pressed={included} onClick={onToggle}>
          {included && <Icon name="check" size={14} stroke={2.6} />}
          {included ? 'Wordt geïmporteerd' : 'Toch importeren'}
        </button>
      </div>
    </div>
  );
}

interface DuplicatesProps {
  items: ProbableDuplicate[];
  /** All probable duplicates the server found; the list holds the first of them. */
  total: number;
  /** The lines of `items` to import anyway. */
  included: ReadonlySet<number>;
  onToggle: (line: number) => void;
  onAll: (on: boolean) => void;
}

/** The probable duplicates, skipped unless the user includes one; the file's row and the stored row side by side. */
export function DuplicatesSection({ items, total, included, onToggle, onAll }: DuplicatesProps) {
  const [showAll, setShowAll] = useState(false);
  if (!total) return null;
  const skipped = total - items.filter((d) => included.has(d.line)).length;
  const allIn = items.length > 0 && items.every((d) => included.has(d.line));
  const shown = showAll ? items : items.slice(0, FIRST_LIST);
  return (
    <section className="im-sec anim-in" style={delay(120)} aria-labelledby="im-dup-h">
      <div className="im-sec-head">
        <h3 className="im-sec-title" id="im-dup-h">
          Waarschijnlijke dubbels
        </h3>
        <span className="im-sec-meta">{num(skipped)} overgeslagen</span>
      </div>
      <p className="im-help">Zelfde bedrag, hoogstens één dag verschil en een tegenpartij die erop lijkt. We slaan ze over, tenzij je kiest voor ‘Toch importeren’.</p>
      <div className="im-dups">{shown.map((d) => <DuplicateRow key={d.line} d={d} included={included.has(d.line)} onToggle={() => onToggle(d.line)} />)}</div>
      <div className="im-dup-actions">
        {items.length > FIRST_LIST && (
          <button type="button" className="im-more" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Toon minder' : 'Toon alle ' + items.length + ' dubbels'}
          </button>
        )}
        <button type="button" className="im-more" onClick={() => onAll(!allIn)}>
          {allIn ? 'Geen dubbels opnemen' : 'Alles opnemen'}
        </button>
      </div>
      {total > items.length && <p className="im-help">{plural(total - items.length, 'dubbel staat', 'dubbels staan')} niet in deze lijst en {total - items.length === 1 ? 'wordt' : 'worden'} overgeslagen.</p>}
    </section>
  );
}
