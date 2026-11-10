// The detail of a transaction, the same content in the phone bottom sheet and the desktop side panel:
// facts, where the category came from, the category picker, "apply to similar and create a rule", note,
// split (phase 0.4-3). Design: finance-mockup/js/screens/transacties.js (detail, sourceStrip, picker,
// partsView, splitEditor); spec: analysis/screens/transacties.md; API: docs/api.md "Categorise a transaction".
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon } from '../components/Icon';
import { accColour, isShared, manager } from '../lib/accounts';
import { api, errorMessage } from '../lib/api';
import { catColours, categoryLabel, groupTree, plural, ruleLabel, skippedText, splitState, toParts, type SplitDraft, type TreeGroup } from '../lib/categories';
import { dateFull, eur } from '../lib/format';
import type { Account, Rule, SimilarPreview, Split, Transaction, TreeCategory } from '../lib/types';
import type { AsyncState } from '../lib/useAsync';
import { useAsync } from '../lib/useAsync';

export interface CatView {
  name: string;
  bg: string;
  fg: string;
  uncat: boolean;
  transfer: boolean;
  split: boolean;
}

/** How a row shows its category: split, the pastel of its category, a transfer, or "Niet gecategoriseerd". */
export function catView(t: Transaction): CatView {
  if (t.splits) return { name: 'Gesplitst · ' + t.splits.length + ' categorieën', bg: '', fg: '', uncat: false, transfer: t.transfer, split: true };
  if (t.category) return { name: t.category.name, ...catColours(t.category.colour), uncat: false, transfer: t.transfer, split: false };
  if (t.transfer) return { name: 'Overschrijving', bg: '', fg: '', uncat: false, transfer: true, split: false };
  return { name: 'Niet gecategoriseerd', bg: '', fg: '', uncat: true, transfer: false, split: false };
}

/** Expense in red, income and transfers in text colour, pending muted (analysis/screens/transacties.md). */
export function amountClass(t: Transaction): string {
  if (t.status === 'pending') return 'muted';
  return t.amount < 0 && !t.transfer ? 'neg' : '';
}

const initialOf = (name: string) => (name.match(/[\p{L}\p{N}]/u)?.[0] || '?').toUpperCase();

/** The mockup's split avatar: the part pastels as diagonal bands, in proportion to the amounts. */
function splitBg(parts: Split[]): string {
  const total = parts.reduce((s, p) => s + Math.abs(p.amount), 0) || 1;
  let run = 0;
  const stops = parts.map((p) => {
    const a = (run / total) * 100;
    run += Math.abs(p.amount);
    return catColours(p.category.colour).bg + ' ' + a.toFixed(1) + '% ' + ((run / total) * 100).toFixed(1) + '%';
  });
  return 'linear-gradient(135deg, ' + stops.join(', ') + ')';
}

export function Avatar({ t, large }: { t: Transaction; large?: boolean }) {
  const cv = catView(t);
  const cls = 'tx-av' + (large ? ' tx-av--lg' : '');
  if (t.splits) {
    return (
      <span className={cls} style={{ background: splitBg(t.splits), color: 'var(--onPastel)' }} aria-hidden="true">
        {initialOf(t.counterparty)}
      </span>
    );
  }
  if (cv.transfer && !t.category) {
    return (
      <span className={cls + ' tx-av--tr'} aria-hidden="true">
        <Icon name="transfer" size={18} stroke={2.2} />
      </span>
    );
  }
  if (cv.uncat) {
    return (
      <span className={cls + ' tx-av--uncat'} aria-hidden="true">
        ?
      </span>
    );
  }
  return (
    <span className={cls} style={{ background: cv.bg, color: cv.fg }} aria-hidden="true">
      {initialOf(t.counterparty)}
    </span>
  );
}

/** Persoonlijk / Gedeeld label with the account's own colour as a dot (decision 3 Nov 2026). */
export function AccLabel({ acc }: { acc: Account | undefined }) {
  const shared = acc ? isShared(acc) : false;
  return (
    <span className={'acc-label acc-label--' + (shared ? 'ged' : 'pers') + ' tx-acc'}>
      <i style={{ background: accColour(acc?.colour) }} aria-hidden="true" />
      {shared ? 'Gedeeld' : 'Persoonlijk'}
    </span>
  );
}

// ---------- Pieces ----------

const OFFLINE_TOAST = 'Je bent offline · wijzigen kan weer zodra je verbinding hebt';
const PENDING_SPLIT = 'Splitsen kan pas als de bank de transactie boekt.';
const MAX_PARTS = 10;

function Offline() {
  return (
    <p className="tx-offline">
      <Icon name="cloudOff" size={16} stroke={2.2} />
      Je bent offline. Opslaan kan weer zodra je verbinding hebt.
    </p>
  );
}

/** A select over the whole tree (Uitgaven / Inkomsten, each top followed by its subs), with the pastel dot. */
function CatSelect(p: {
  id: string;
  label: string;
  placeholder: string;
  value: number | null;
  groups: { expense: TreeGroup[]; income: TreeGroup[] };
  byId: ReadonlyMap<number, TreeCategory>;
  dataKey: string;
  blocked?: boolean;
  onPick: (id: number | null) => void;
}) {
  const c = p.value !== null ? p.byId.get(p.value) : undefined;
  return (
    <div className="tx-part-cat">
      <i className={'tx-part-dot' + (c ? '' : ' tx-part-dot--empty')} style={c ? { background: catColours(c.colour).bg } : undefined} aria-hidden="true" />
      <label className="visually-hidden" htmlFor={p.id}>
        {p.label}
      </label>
      <select
        className="input tx-select"
        id={p.id}
        data-key={p.dataKey}
        value={p.value ?? ''}
        aria-disabled={p.blocked || undefined}
        onChange={(e) => p.onPick(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">{p.placeholder}</option>
        {(['expense', 'income'] as const).map(
          (type) =>
            p.groups[type].length > 0 && (
              <optgroup key={type} label={type === 'expense' ? 'Uitgaven' : 'Inkomsten'}>
                {p.groups[type].flatMap((g) => [
                  <option key={g.top.id} value={g.top.id}>
                    {g.top.name}
                  </option>,
                  ...g.subs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {g.top.name + ' › ' + s.name}
                    </option>
                  )),
                ])}
              </optgroup>
            ),
        )}
      </select>
      <Icon name="chevronDown" size={16} stroke={2.4} />
    </div>
  );
}

/** "Ook 14 andere transacties van X krijgen deze categorie." or, with none, "Nieuwe transacties van X …". */
export function similarText(p: SimilarPreview, acc: Account | undefined): string {
  const main =
    p.count > 0
      ? 'Ook ' + plural(p.count, 'andere transactie', 'andere transacties') + ' van ' + p.counterparty + (p.count === 1 ? ' krijgt' : ' krijgen') + ' deze categorie.'
      : 'Nieuwe transacties van ' + p.counterparty + ' krijgen deze categorie.';
  return main + (p.scope === 'account' ? ' De regel geldt voor alle leden van de ' + (acc?.name ?? 'rekening') + '.' : '');
}

const fmtIn = (cents: number) => (Math.abs(cents) / 100).toFixed(2).replace('.', ',');

type Part = SplitDraft & { k: number };

export interface JustRule {
  id: number;
  name: string;
}

interface DetailProps {
  t: Transaction;
  acc: Account | undefined;
  mode: 'sheet' | 'panel';
  onClose?: () => void;
  cats: AsyncState<TreeCategory[]>;
  rules: Rule[] | undefined;
  /** The rule just made from this row with "apply to similar" (the mockup's "Via nieuwe regel"). */
  newRule: JustRule | null;
  /** The server's answer for this row; `rule` set: after "apply to similar", `null`: the category changed. */
  onChange: (t: Transaction, rule?: JustRule | null) => void;
}

// ---------- Detail ----------

export function Detail({ t, acc, mode, onClose, cats, rules, newRule, onChange }: DetailProps) {
  const { toast, online } = useApp();
  const sheet = mode === 'sheet';
  const pending = t.status === 'pending';
  const ro = acc?.permission === 'read';
  const cv = catView(t);
  const tree = cats.data;
  const byId = useMemo(() => new Map((tree ?? []).map((c) => [c.id, c])), [tree]);
  const groups = useMemo(() => groupTree(tree ?? []), [tree]);

  const [note, setNote] = useState(t.note ?? '');
  const [rule, setRule] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [parts, setParts] = useState<Part[] | null>(null);
  const nextKey = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const focusKey = useRef<string | null>(null);

  // Keyboard focus follows the view: into the split editor, back to the button that opened it, …
  // A layout effect, so focus moves in the same commit that swaps the view: with useEffect it ran after paint,
  // leaving a moment where the removed button's focus had fallen back to <body>.
  useLayoutEffect(() => {
    const k = focusKey.current;
    if (!k) return;
    focusKey.current = null;
    rootRef.current?.querySelector<HTMLElement>('[data-key="' + k + '"]')?.focus();
  });

  const showRule = !ro && !t.splits && !(t.transfer && !t.category) && t.counterparty.trim() !== '';
  const catId = t.category?.id;
  const preview = useAsync<SimilarPreview | null>((signal) => (showRule && catId !== undefined ? api.similarPreview(t.id, signal) : Promise.resolve(null)), [t.id, catId, showRule]);

  /** One request at a time: a second press while one runs is ignored; failures toast the server's message. */
  const run = async (key: string, work: () => Promise<void>) => {
    if (busyRef.current) return;
    if (!online) {
      toast(OFFLINE_TOAST);
      return;
    }
    busyRef.current = true;
    setBusy(key);
    try {
      await work();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };
  const off = !online || busy !== null;

  const pick = (id: number | null) => {
    if (id === null || (id === catId && t.categoryOrigin === 'manual')) return;
    void run('pick', async () => onChange(await api.updateTransaction(t.id, { categoryId: id }), null));
  };

  const confirm = () =>
    void run('confirm', async () => {
      const n = await api.updateTransaction(t.id, { categoryId: catId! });
      onChange(n, null);
      toast('Suggestie bevestigd · ' + categoryLabel(n.category ?? t.category!, byId));
    });

  const save = () => {
    const clean = note.replace(/\s+/g, ' ').trim();
    const withRule = rule && showRule && catId !== undefined;
    void run('save', async () => {
      let text = 'Opgeslagen';
      if (clean !== (t.note ?? '')) {
        const n = await api.updateTransaction(t.id, { note: clean });
        setNote(n.note ?? '');
        onChange(n);
      }
      if (withRule) {
        const r = await api.applySimilar(t.id);
        const skipped = skippedText(r.skipped);
        text = (r.ruleCreated ? 'Regel gemaakt' : 'Regel bijgewerkt') + ' · ' + r.updated + ' andere bijgewerkt' + (skipped ? ' · ' + skipped : '');
        setRule(false);
        onChange(r.transaction, { id: r.rule.id, name: ruleLabel(r.rule) });
      }
      toast(text);
      if (sheet) onClose?.();
    });
  };

  // ---------- Split ----------

  const draft = (categoryId: number | null, input: string): Part => ({ categoryId, input, k: nextKey.current++ });

  const startSplit = () => {
    if (pending) return toast(PENDING_SPLIT);
    if (!online) return toast(OFFLINE_TOAST);
    if (!tree || busy) return;
    setParts(t.splits ? t.splits.map((p) => draft(p.category.id, fmtIn(p.amount))) : [draft(catId ?? null, ''), draft(null, '')]);
    focusKey.current = 'pc0';
  };
  const closeSplit = () => {
    setParts(null);
    focusKey.current = 'split';
  };
  const setPart = (i: number, patch: Partial<SplitDraft>) => setParts((ps) => ps && ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  if (parts && !ro) {
    const st = splitState(t.amount, parts);
    const restCls = st.rest === 0 ? 'ok' : st.rest < 0 ? 'neg' : 'open';
    const saveSplit = () => {
      if (!st.ok) return toast(st.hint || 'Verdeel eerst het hele bedrag.');
      void run('split', async () => {
        const n = await api.splitTransaction(t.id, toParts(t.amount, parts));
        onChange(n, null);
        setParts(null);
        focusKey.current = 'split';
        toast('Gesplitst over ' + parts.length + ' categorieën');
      });
    };
    const unsplit = () =>
      void run('unsplit', async () => {
        const n = await api.unsplitTransaction(t.id);
        onChange(n, null);
        setParts(null);
        focusKey.current = 'split';
        toast('Splitsing ongedaan gemaakt');
      });
    return (
      <div className={'tx-detail tx-split tx-detail--' + mode} ref={rootRef}>
        <div className="tx-detail-head">
          <button type="button" className="tx-close" data-key="back" aria-label="Terug naar de transactie" onClick={closeSplit}>
            <Icon name="back" size={20} stroke={2.4} />
          </button>
          <div className="tx-detail-title">
            <span className="tx-detail-name" id={sheet ? 'tx-sheet-title' : undefined}>
              Splitsen
            </span>
            <span className="tx-row-sub">
              <span className="tx-row-sub-text">{t.counterparty}</span>
            </span>
          </div>
          <span className={'mono tx-split-total ' + amountClass(t)}>{eur(t.amount, true)}</span>
        </div>
        <p className="tx-help">Verdeel het bedrag over twee of meer categorieën. Elk deel telt mee in zijn eigen categorie.</p>
        <div className="tx-parts" role="group" aria-label="Delen">
          {parts.map((p, i) => {
            const pid = 'tx-part-' + mode + '-' + i;
            return (
              <div className="tx-part" key={p.k}>
                <CatSelect
                  id={pid + '-c'}
                  label={'Categorie van deel ' + (i + 1)}
                  placeholder="Kies een categorie"
                  value={p.categoryId}
                  groups={groups}
                  byId={byId}
                  dataKey={'pc' + i}
                  onPick={(id) => setPart(i, { categoryId: id })}
                />
                <div className="tx-money">
                  <span aria-hidden="true">€</span>
                  <label className="visually-hidden" htmlFor={pid + '-a'}>
                    {'Bedrag van deel ' + (i + 1)}
                  </label>
                  <input
                    className="input tx-money-input"
                    id={pid + '-a'}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0,00"
                    maxLength={16}
                    value={p.input}
                    onChange={(e) => setPart(i, { input: e.target.value })}
                  />
                </div>
                <button
                  type="button"
                  className="tx-part-del"
                  data-key={'pd' + i}
                  aria-label={'Deel ' + (i + 1) + ' verwijderen'}
                  disabled={parts.length <= 2}
                  onClick={() => {
                    setParts(parts.filter((_, j) => j !== i));
                    focusKey.current = 'add';
                  }}
                >
                  <Icon name="trash" size={18} stroke={2} />
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="tx-add"
          data-key="add"
          disabled={parts.length >= MAX_PARTS}
          onClick={() => {
            setParts([...parts, draft(null, '')]);
            focusKey.current = 'pc' + parts.length;
          }}
        >
          <Icon name="plus" size={16} stroke={2.6} />
          Deel toevoegen
        </button>
        <div className="tx-rest-wrap" aria-live="polite">
          <div className={'tx-rest tx-rest--' + restCls}>
            {st.rest === 0 && <Icon name="check" size={16} stroke={2.6} />}
            <span>{st.rest < 0 ? 'Te veel verdeeld' : 'Nog te verdelen'}</span>
            <span className="mono">{eur(Math.abs(st.rest))}</span>
          </div>
          {st.hint && <p className="tx-help">{st.hint}</p>}
        </div>
        <div className="tx-btns">
          <button type="button" className="tx-btn tx-btn--ghost" data-key="cancel" onClick={closeSplit}>
            Annuleren
          </button>
          <button
            type="button"
            className="tx-btn tx-btn--primary"
            data-key="ssave"
            aria-disabled={!st.ok || off}
            aria-busy={busy === 'split' || undefined}
            onClick={saveSplit}
          >
            Opslaan
          </button>
        </div>
        {!online && <Offline />}
        {t.splits && (
          <button type="button" className="tx-linkbtn" data-key="unsplit" aria-disabled={off || undefined} aria-busy={busy === 'unsplit' || undefined} onClick={unsplit}>
            Splitsing ongedaan maken
          </button>
        )}
      </div>
    );
  }

  // ---------- Detail view ----------

  const strip = (cls: string, icon: ReactNode, title: string, sub: string, end?: ReactNode) => (
    <div className={'tx-src' + cls}>
      {icon}
      <span className="tx-src-text">
        <strong>{title}</strong>
        <span>{sub}</span>
      </span>
      {end}
    </div>
  );
  const ruleLink = (id: number, text: string) => (
    <Link className="tx-src-link" to={'/categorieen?tab=regels&regel=' + id}>
      {text}
    </Link>
  );
  let source: ReactNode = null;
  if (t.category && !t.splits) {
    const tag = <Icon name="tag" size={18} stroke={2.2} />;
    if (newRule && !ro) source = strip('', tag, 'Via nieuwe regel ‘' + newRule.name + '’', 'Net gemaakt · staat bij je regels', ruleLink(newRule.id, 'Regel bekijken'));
    else if (t.categoryOrigin === 'rule') {
      const r = t.ruleId !== null ? rules?.find((x) => x.id === t.ruleId) : undefined;
      source = strip('', tag, r ? 'Via regel ‘' + ruleLabel(r) + '’' : 'Via een regel', 'Geldt ook voor nieuwe transacties', !ro && t.ruleId !== null ? ruleLink(t.ruleId, 'Regel aanpassen') : null);
    } else if (t.categoryOrigin === 'suggestion') {
      source = strip(
        ' tx-src--sugg',
        <Icon name="spark" size={18} stroke={2} />,
        'Suggestie',
        'Saldo leerde dit uit je eerdere keuzes',
        !ro && (
          <button type="button" className="tx-src-btn" data-key="confirm" aria-disabled={off || undefined} aria-busy={busy === 'confirm' || undefined} onClick={confirm}>
            Bevestigen
          </button>
        ),
      );
    } else if (t.categoryOrigin === 'import') {
      source = strip('', <Icon name="upload" size={18} stroke={2.2} />, 'Uit je importbestand', 'Regels en suggesties overschrijven dit niet');
    } else if (t.categoryOrigin === 'manual') {
      source = strip(' tx-src--manual', <Icon name="check" size={18} stroke={2.4} />, 'Zelf gekozen', 'Regels en suggesties overschrijven dit niet');
    }
  }

  const transferNote = t.transfer && (
    <div className="tx-note tx-note--transfer">
      <Icon name="transfer" size={18} stroke={2.2} />
      <span>
        <strong>Overschrijving tussen eigen rekeningen</strong>
        <br />
        Telt niet mee als inkomen of uitgave
      </span>
    </div>
  );

  let edit: ReactNode = null;
  if (t.splits) {
    edit = (
      <div className="tx-partsview">
        <span className="tx-picker-label">Verdeling</span>
        <div className="tx-splitbar" aria-hidden="true">
          {t.splits.map((p, i) => (
            <span key={i} style={{ flex: Math.abs(p.amount), background: catColours(p.category.colour).bg }} />
          ))}
        </div>
        <ul className="tx-partlist">
          {t.splits.map((p, i) => (
            <li key={i}>
              <i className="tx-dot" style={{ background: catColours(p.category.colour).bg }} aria-hidden="true" />
              <span className="tx-part-name">{categoryLabel(p.category, byId)}</span>
              <span className={'mono ' + (p.amount < 0 && !pending ? 'neg' : '')}>{eur(p.amount, true)}</span>
            </li>
          ))}
        </ul>
        {!ro && (
          <button type="button" className="tx-action tx-action--wide" data-key="split" aria-disabled={off || undefined} onClick={startSplit}>
            <Icon name="split" size={16} stroke={2.2} />
            Splitsing aanpassen
          </button>
        )}
      </div>
    );
  } else if (!ro && !(t.transfer && !t.category)) {
    const labelId = 'tx-pick-label-' + mode;
    const type = t.amount > 0 ? 'income' : 'expense';
    const tops = groups[type].map((g) => g.top);
    let body: ReactNode;
    if (!tree && cats.error) {
      body = (
        <div className="tx-note tx-note--muted tx-cats-err" role="alert">
          <span>{cats.error}</span>
          <button type="button" className="tx-src-btn" onClick={cats.reload}>
            Opnieuw proberen
          </button>
        </div>
      );
    } else if (!tree) {
      body = (
        <div className="tx-picks" role="status" aria-label="Categorieën laden">
          {[96, 128, 88, 104].map((w) => (
            <span key={w} className="tx-skel" style={{ width: w, height: 40, borderRadius: 20 }} />
          ))}
        </div>
      );
    } else if (!tree.length) {
      body = (
        <p className="tx-note tx-note--muted">
          Nog geen categorieën.{' '}
          <Link className="tx-src-link" to="/categorieen">
            Categorieën maken
          </Link>
        </p>
      );
    } else {
      body = (
        <>
          <div className="tx-picks" role="group" aria-labelledby={labelId} aria-busy={busy === 'pick' || undefined}>
            {tops.map((c) => {
              const on = c.id === catId;
              const { bg, fg } = catColours(c.colour);
              return (
                <button
                  key={c.id}
                  type="button"
                  className="tx-pick"
                  data-key={'pick-' + c.id}
                  aria-pressed={on}
                  aria-disabled={off || undefined}
                  style={on ? { background: bg, color: fg, borderColor: 'var(--text)' } : { borderColor: c.colour === 'soft' ? 'var(--softChip)' : bg }}
                  onClick={() => pick(c.id)}
                >
                  {on && <Icon name="check" size={sheet ? 15 : 14} stroke={3} />}
                  {c.name}
                </button>
              );
            })}
          </div>
          <CatSelect
            id={'tx-pick-all-' + mode}
            label="Alle categorieën"
            placeholder="Alle categorieën"
            value={catId !== undefined && !tops.some((c) => c.id === catId) ? catId : null}
            groups={groups}
            byId={byId}
            dataKey="pick-all"
            blocked={off}
            onPick={pick}
          />
        </>
      );
    }

    let desc: ReactNode = null;
    let skipped = '';
    if (catId === undefined) desc = 'Kies eerst een categorie.';
    else if (preview.loading) desc = <span className="tx-skel tx-skel--line" role="status" aria-label="Laden" />;
    else if (preview.error) desc = preview.error;
    else if (preview.data) {
      desc = similarText(preview.data, acc);
      skipped = skippedText(preview.data.skipped);
    }
    const descId = 'tx-rule-desc-' + mode;
    const splitHint = 'tx-split-hint-' + mode;
    edit = (
      <div className="tx-picker">
        <span className="tx-picker-label" id={labelId}>
          Kies een categorie
        </span>
        {body}
        {showRule && preview.data?.counterparty !== '' && (
          <label className="tx-rule">
            <input
              type="checkbox"
              data-key="rule"
              checked={rule}
              disabled={catId === undefined || !online}
              aria-labelledby={descId + '-title'}
              aria-describedby={descId + (skipped ? ' ' + descId + '-skip' : '')}
              onChange={(e) => setRule(e.target.checked)}
            />
            <span>
              <strong id={descId + '-title'}>Toepassen op vergelijkbare en regel maken</strong>
              <br />
              <span className="muted" id={descId}>
                {desc}
              </span>
              {skipped && (
                <>
                  <br />
                  <span className="muted" id={descId + '-skip'}>
                    {skipped + ' · die blijven staan.'}
                  </span>
                </>
              )}
            </span>
          </label>
        )}
        <button
          type="button"
          className="tx-action tx-action--wide"
          data-key="split"
          aria-disabled={pending || off || !tree || undefined}
          aria-describedby={pending ? splitHint : undefined}
          onClick={startSplit}
        >
          Splitsen
        </button>
        {pending && (
          <p className="tx-help" id={splitHint}>
            {PENDING_SPLIT}
          </p>
        )}
      </div>
    );
  }

  const mgr = acc ? manager(acc) : undefined;
  const noteId = 'tx-note-' + mode;
  const shared = acc ? isShared(acc) : false;
  return (
    <div className={'tx-detail tx-detail--' + mode} ref={rootRef}>
      <div className="tx-detail-head">
        <Avatar t={t} large />
        <div className="tx-detail-title">
          <span className="tx-detail-name" id={sheet ? 'tx-sheet-title' : undefined}>
            {t.counterparty}
          </span>
          <span className="tx-row-sub">
            <AccLabel acc={acc} />
            <span className="tx-row-sub-text">{acc?.name}</span>
          </span>
        </div>
        {sheet && (
          <button type="button" className="tx-close" aria-label="Sluiten" onClick={onClose} data-autofocus>
            <Icon name="close" size={18} stroke={2.4} />
          </button>
        )}
      </div>
      <div className="tx-detail-amount">
        <span className={'mono ' + amountClass(t)}>{eur(t.amount, true)}</span>
        <span className="tx-status">{pending ? 'In behandeling' : 'Geboekt'}</span>
      </div>
      <dl className="tx-dl">
        <dt>Datum</dt>
        <dd>{dateFull(t.bookingDate)}</dd>
        <dt>Mededeling</dt>
        <dd>{t.communication || '–'}</dd>
        <dt>Categorie</dt>
        <dd className="tx-dl-strong">{t.category && !t.splits ? categoryLabel(t.category, byId) : cv.name}</dd>
        {ro && t.note && (
          <>
            <dt>Notitie</dt>
            <dd>{t.note}</dd>
          </>
        )}
      </dl>
      {pending && <p className="tx-note tx-note--muted">Nog in behandeling. Telt mee in de totalen zodra de bank ze boekt.</p>}
      {source}
      {ro && (
        <div className="tx-ro">
          <span className="chip chip--readonly">
            <Icon name="lock" size={14} stroke={2.2} />
            Alleen lezen
          </span>
          <p>
            {(mgr && !mgr.me ? mgr.name : 'De beheerder') + ' gaf je leesrechten op de ' + (acc?.name ?? 'rekening') + '. Categorie, splitsing en notitie kan je hier niet wijzigen.'}
          </p>
        </div>
      )}
      {transferNote}
      {edit}
      {!ro && (
        <>
          <div className="field tx-field">
            <label htmlFor={noteId}>Notitie</label>
            <input
              className="input"
              id={noteId}
              data-key="note"
              placeholder="Bijvoorbeeld: verjaardagscadeau"
              maxLength={200}
              value={note}
              readOnly={!online}
              aria-disabled={!online || undefined}
              aria-describedby={shared ? noteId + '-hint' : undefined}
              onChange={(e) => setNote(e.target.value)}
            />
            {shared && (
              <p className="tx-help" id={noteId + '-hint'}>
                Zichtbaar voor iedereen met toegang tot deze rekening
              </p>
            )}
          </div>
          {!online && <Offline />}
          <button type="button" className="tx-save" data-key="save" aria-disabled={off || undefined} aria-busy={busy === 'save' || undefined} onClick={save}>
            Opslaan
          </button>
        </>
      )}
    </div>
  );
}
