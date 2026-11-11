// The editors of Categorieën en regels, shown in the phone sheet or the desktop panel: a category, the
// removal of a category, a rule (new, edit, read-only) and the info "Zo kiest Saldo een categorie".
// Design: finance-mockup/js/screens/categorieen.js (catEditor, delEditor, ruleEditor, roRule, info).
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useApp } from '../app/AppContext';
import { Icon, type IconName } from '../components/Icon';
import { IconPicker } from '../components/IconPicker';
import { Select } from '../components/Select';
import { accColour, isShared, manager, others } from '../lib/accounts';
import { api, ApiError, errorMessage, isAbort } from '../lib/api';
import { catColours, categoryLabel, plural, ruleConditions, skippedText } from '../lib/categories';
import { categoryIcon } from '../lib/categoryIcons';
import { names, parseMoney } from '../lib/format';
import type { Account, CategoryColour, CategoryPatch, Rule, RuleInput, RulePreview, Suggestion, TreeCategory } from '../lib/types';

export type Mode = 'p' | 'd';
type Look = { bg: string; fg: string };

export const PASTELS: [CategoryColour, string][] = [
  ['c1', 'Lichtblauw'],
  ['c2', 'Abrikoos'],
  ['c3', 'Roze'],
  ['c4', 'Lavendel'],
  ['c5', 'Geel'],
  ['c6', 'Grijs'],
];

export const BAD_REGEX = 'Deze reguliere expressie klopt niet.';
const OFFLINE = 'Je bent offline. Opslaan kan weer zodra je verbinding hebt.';

// ---------- Small pieces ----------

export function CatChip({ c, byId }: { c: TreeCategory | undefined; byId: ReadonlyMap<number, TreeCategory> }) {
  if (!c) return null;
  const lk = catColours(c.colour);
  const parent = c.parentId === null ? undefined : byId.get(c.parentId);
  return (
    <span className="ct-chip" style={{ background: lk.bg, color: lk.fg }}>
      <Icon name={categoryIcon(c.icon)} size={13} stroke={2.4} className="ct-chip-ico" />
      {parent && <span className="ct-chip-parent">{parent.name} ›</span>} {c.name}
    </span>
  );
}

export function OwnerChip({ accountId, accounts }: { accountId: number | null; accounts: Account[] }) {
  if (accountId === null) {
    return (
      <span className="ct-owner ct-owner--me">
        <Icon name="person" size={13} stroke={2.4} />
        Jij
      </span>
    );
  }
  const a = accounts.find((x) => x.id === accountId);
  return (
    <span className="ct-owner">
      <i style={{ background: accColour(a?.colour) }} />
      {a ? a.name : 'Rekening'}
    </span>
  );
}

export function ReadOnlyChip({ head }: { head?: boolean }) {
  return (
    <span className={'chip chip--readonly ct-ro' + (head ? ' ct-ro--head' : '')}>
      <Icon name="lock" size={12} stroke={2.4} />
      Alleen lezen
    </span>
  );
}

function Head({ look, icon, title, sub, inSheet, onClose, extra }: { look: Look; icon: IconName; title: string; sub: string; inSheet: boolean; onClose?: () => void; extra?: ReactNode }) {
  return (
    <div className="ct-ed-head">
      <span className="ct-ed-icon" style={{ background: look.bg, color: look.fg }}>
        <Icon name={icon} size={20} stroke={2.2} />
      </span>
      <div className="ct-ed-title">
        <span className="ct-ed-name">{title}</span>
        <span className="ct-ed-sub">{sub}</span>
        {extra}
      </div>
      {inSheet && (
        <button type="button" className="ct-close" aria-label="Sluiten" data-key="close" onClick={onClose}>
          <Icon name="close" size={18} stroke={2.4} />
        </button>
      )}
    </div>
  );
}

function Offline() {
  const { online } = useApp();
  if (online) return null;
  return (
    <p className="ct-offline">
      <Icon name="cloudOff" size={16} stroke={2.2} />
      <span>{OFFLINE}</span>
    </p>
  );
}

const Err = ({ id, msg }: { id: string; msg?: string | null }) =>
  msg ? (
    <p className="ct-err" id={id}>
      {msg}
    </p>
  ) : null;

const invalid = (id: string, msg?: string | null) => (msg ? { 'aria-invalid': true as const, 'aria-describedby': id } : {});

/** One request at a time, also for a double press in the same tick; `busy` disables the buttons meanwhile. */
function useBusy() {
  const ref = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    if (ref.current) return;
    ref.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      ref.current = false;
      setBusy(false);
    }
  };
  return { busy, run };
}

/** Focus the first field with an error, after it rendered. */
function focusFirst(root: HTMLElement | null, keys: string[]) {
  requestAnimationFrame(() => {
    for (const k of keys) {
      const el = root?.querySelector<HTMLElement>('[data-key="' + k + '"]');
      if (el) {
        el.focus();
        return;
      }
    }
  });
}

// ---------- Info ----------

export function Info() {
  const step = (n: number, t: string, s: string) => (
    <li>
      <span className="ct-step-n">{n}</span>
      <span className="ct-step-text">
        <strong>{t}</strong>
        <span>{s}</span>
      </span>
    </li>
  );
  return (
    <div className="ct-info">
      <div className="ct-ed-head">
        <span className="ct-ed-icon" style={{ background: 'var(--soft)', color: 'var(--greenText)' }}>
          <Icon name="spark" size={20} stroke={2} />
        </span>
        <div className="ct-ed-title">
          <h2 className="ct-ed-name">Zo kiest Saldo een categorie</h2>
          <span className="ct-ed-sub">Voor elke transactie, in deze volgorde</span>
        </div>
      </div>
      <ol className="ct-steps">
        {step(1, 'Jouw keuze', 'Een categorie die je zelf kiest, blijft altijd staan. Ook als regels opnieuw lopen.')}
        {step(2, 'Een regel', 'Anders de regel met de hoogste prioriteit die past.')}
        {step(3, 'Een suggestie', 'Anders wat Saldo leerde uit je eerdere keuzes.')}
      </ol>
      <p className="ct-box">Een suggestie met lage zekerheid past Saldo nooit toe zonder jouw bevestiging. Bevestig je ze, dan krijgen de open transacties die categorie en maakt Saldo er een regel van voor nieuwe transacties op je persoonlijke rekeningen.</p>
    </div>
  );
}

// ---------- Category ----------

type Place = 'top-expense' | 'top-income' | string;

const placeOf = (c: TreeCategory): Place => (c.parentId !== null ? String(c.parentId) : 'top-' + c.type);

interface CatEditorProps {
  mode: Mode;
  /** null: a new category. */
  cat: TreeCategory | null;
  /** A new subcategory under this top category. */
  parentId?: number;
  tree: TreeCategory[];
  /** The viewer has transactions: show the counts. */
  counts: boolean;
  onSaved: (c: TreeCategory, isNew: boolean) => void;
  onRemove: () => void;
  onNewSub: (parentId: number) => void;
  onClose: () => void;
}

export function CatEditor({ mode, cat: c, parentId, tree, counts, onSaved, onRemove, onNewSub, onClose }: CatEditorProps) {
  const { online, toast } = useApp();
  const byId = new Map(tree.map((x) => [x.id, x]));
  const [name, setName] = useState(c ? c.name : '');
  const [place, setPlace] = useState<Place>(c ? placeOf(c) : parentId !== undefined ? String(parentId) : 'top-expense');
  const [colour, setColour] = useState<CategoryColour>(c && c.type === 'expense' && c.parentId === null ? c.colour : 'c1');
  /** `null`: not touched, so a create sends none and a save keeps the stored icon. */
  const [icon, setIcon] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { busy, run } = useBusy();
  const root = useRef<HTMLDivElement>(null);
  const id = (k: string) => 'ct-' + mode + '-' + k;

  const isTop = place === 'top-expense' || place === 'top-income';
  const parent = isTop ? undefined : byId.get(Number(place));
  const look: Look = place === 'top-expense' ? catColours(colour) : place === 'top-income' ? catColours('soft') : catColours(parent?.colour ?? 'c6');
  const shownIcon = categoryIcon(icon ?? c?.icon);
  // The picker draws in the main category's colour: its own, or the parent's for a subcategory.
  const iconColour: CategoryColour = place === 'top-expense' ? colour : place === 'top-income' ? 'soft' : (parent?.colour ?? 'c6');
  const kids = c ? tree.filter((x) => x.parentId === c.id) : [];
  const k = kids.length;
  const shown = name.trim() || (c ? c.name : 'Nieuwe categorie');
  const sub = c
    ? (c.type === 'income' ? 'Inkomst' : 'Uitgave') + (c.parentId !== null ? ' · onder ' + (byId.get(c.parentId)?.name ?? '') : ' · hoofdcategorie')
    : 'Nieuwe ' + (isTop ? 'hoofdcategorie' : 'subcategorie') + ' · voor alle gebruikers';
  const count = c && counts ? (k ? c.count + kids.reduce((s, x) => s + x.count, 0) : c.count) : null;

  const onSwatchKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in steps)) return;
    e.preventDefault();
    const i = PASTELS.findIndex((p) => p[0] === colour);
    const next = PASTELS[(i + steps[e.key] + PASTELS.length) % PASTELS.length][0];
    setColour(next);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[data-key="sw-' + next + '"]')?.focus());
  };

  const save = () =>
    run(async () => {
      const clean = name.trim() || (c ? c.name : '');
      if (!clean) {
        setErr('Geef de categorie een naam.');
        focusFirst(root.current, ['name']);
        return;
      }
      const type = isTop ? (place === 'top-income' ? 'income' : 'expense') : (parent?.type ?? 'expense');
      try {
        let saved: TreeCategory;
        if (!c) {
          const extra = icon ? { icon } : {};
          saved = await api.createCategory(isTop ? { name: clean, type, ...(type === 'expense' ? { colour } : {}), ...extra } : { name: clean, parentId: Number(place), ...extra });
        } else {
          const patch: CategoryPatch = {};
          if (clean !== c.name) patch.name = clean;
          if (isTop) {
            if (c.parentId !== null) patch.parentId = null;
            if (type !== c.type) patch.type = type;
            if (type === 'expense' && (colour !== c.colour || patch.parentId === null || patch.type)) patch.colour = colour;
          } else if (Number(place) !== c.parentId) patch.parentId = Number(place);
          if (icon !== null && icon !== categoryIcon(c.icon)) patch.icon = icon;
          saved = Object.keys(patch).length ? await api.updateCategory(c.id, patch) : c;
        }
        toast(saved.name + (c ? ' opgeslagen' : ' toegevoegd'));
        onSaved(saved, !c);
      } catch (e) {
        if (e instanceof ApiError && e.status === 400) {
          setErr(e.message);
          focusFirst(root.current, ['name']);
        } else toast(errorMessage(e));
      }
    });

  return (
    <div className="ct-editor" ref={root}>
      <Head look={look} icon={shownIcon} title={shown} sub={sub} inSheet={mode === 'p'} onClose={onClose} />
      <div className="ct-field">
        <label className="ct-label" htmlFor={id('name')}>
          Naam
        </label>
        <input
          className="input"
          id={id('name')}
          autoComplete="off"
          maxLength={60}
          placeholder="Bijvoorbeeld: Huisdieren"
          value={name}
          data-key="name"
          onChange={(e) => {
            setName(e.target.value);
            setErr(null);
          }}
          {...invalid(id('name-err'), err)}
        />
        <Err id={id('name-err')} msg={err} />
        <span className="ct-help">Iedereen ziet dezelfde categorieën. Bedragen en aantallen van anderen zie je nooit.</span>
      </div>
      <div className="ct-field">
        <label className="ct-label" htmlFor={id('place')}>
          Plaats
        </label>
        <Select
          id={id('place')}
          value={place}
          disabled={k > 0}
          onChange={setPlace}
          options={[
            { value: 'top-expense', label: 'Hoofdcategorie bij Uitgaven' },
            { value: 'top-income', label: 'Hoofdcategorie bij Inkomsten' },
            ...tree
              .filter((x) => x.parentId === null && x.id !== c?.id)
              .map((x) => ({ value: String(x.id), label: x.name + (x.type === 'income' ? ' (inkomsten)' : ''), group: 'Subcategorie van' })),
          ]}
        />
        <span className="ct-help">{k ? 'Verplaats eerst de ' + plural(k, 'subcategorie', 'subcategorieën') + '. Saldo heeft twee niveaus.' : 'Twee niveaus: hoofdcategorie en subcategorie.'}</span>
      </div>
      <div className="ct-field">
        <span className="ct-label" id={id('kleur')}>
          Kleur
        </span>
        {place === 'top-expense' ? (
          <>
            <div className="ct-swatches" role="radiogroup" aria-labelledby={id('kleur')}>
              {PASTELS.map(([key, label]) => {
                const on = key === colour;
                const lk = catColours(key);
                return (
                  <button
                    key={key}
                    type="button"
                    className="ct-swatch"
                    role="radio"
                    aria-checked={on}
                    aria-label={label}
                    tabIndex={on ? 0 : -1}
                    data-key={'sw-' + key}
                    style={{ background: lk.bg, color: lk.fg }}
                    onClick={() => setColour(key)}
                    onKeyDown={onSwatchKey}
                  >
                    {on && <Icon name="check" size={16} stroke={3} />}
                  </button>
                );
              })}
            </div>
            <span className="ct-help">Subcategorieën krijgen de kleur van hun hoofdcategorie. Een kleur mag vaker voorkomen.</span>
          </>
        ) : (
          <span className="ct-help">{place === 'top-income' ? 'Inkomsten zijn altijd groen.' : 'Krijgt de kleur van ' + (parent?.name ?? '') + '.'}</span>
        )}
      </div>
      <div className="ct-field">
        <span className="ct-label" id={id('icoon')}>
          Pictogram
        </span>
        <IconPicker value={shownIcon} colour={iconColour} labelledBy={id('icoon')} onChange={setIcon} />
      </div>
      <div className="ct-preview-strip">
        <span className="ct-preview-label">Voorbeeld</span>
        <span className="ct-chip" style={{ background: look.bg, color: look.fg }}>
          <Icon name={shownIcon} size={13} stroke={2.4} className="ct-chip-ico" />
          {parent && <span className="ct-chip-parent">{parent.name} ›</span>} {shown}
        </span>
        {count !== null && (
          <span className="ct-preview-count">
            <span className="mono ct-preview-n">{count}</span> van jou
          </span>
        )}
      </div>
      {c && c.parentId === null && c.type === 'expense' && (
        <button type="button" className="ct-subadd" data-key="new-sub" onClick={() => onNewSub(c.id)}>
          <Icon name="plus" size={16} stroke={2.6} />
          Subcategorie toevoegen
        </button>
      )}
      <div className="ct-actions">
        {c ? (
          <button type="button" className="ct-btn ct-btn--danger" data-key="del" disabled={k > 0 || !online || busy} aria-describedby={k ? id('del-help') : undefined} onClick={onRemove}>
            <Icon name="trash" size={16} stroke={2.2} />
            Verwijderen
          </button>
        ) : (
          <button type="button" className="ct-btn ct-btn--ghost" onClick={onClose}>
            Annuleren
          </button>
        )}
        <button type="button" className="ct-btn ct-btn--primary" data-key="save" disabled={!online || busy} aria-busy={busy || undefined} onClick={() => void save()}>
          Opslaan
        </button>
      </div>
      {k > 0 && (
        <span className="ct-help" id={id('del-help')}>
          Verwijderen kan pas als er geen subcategorieën meer onder hangen.
        </span>
      )}
      <Offline />
    </div>
  );
}

// ---------- Remove a category ----------

/** The categories the transactions of `c` may go to besides its parent: same type, not itself. */
export const otherTargets = (c: TreeCategory, tree: TreeCategory[]) => tree.filter((x) => x.id !== c.id && x.type === c.type && x.id !== c.parentId);

interface DelEditorProps {
  mode: Mode;
  cat: TreeCategory;
  tree: TreeCategory[];
  rules: Rule[];
  counts: boolean;
  /** After the removal: where its transactions went (null: uncategorised). */
  onDone: (target: TreeCategory | null) => void;
  onCancel: () => void;
  onClose: () => void;
}

export function DelEditor({ mode, cat: c, tree, rules, counts, onDone, onCancel, onClose }: DelEditorProps) {
  const { online, toast } = useApp();
  const byId = new Map(tree.map((x) => [x.id, x]));
  const parent = c.parentId === null ? undefined : byId.get(c.parentId);
  const others = otherTargets(c, tree);
  const sibling = others.find((x) => c.parentId !== null && x.parentId === c.parentId);
  const [to, setTo] = useState<'parent' | 'other' | 'none'>(parent ? 'parent' : others.length ? 'other' : 'none');
  const [other, setOther] = useState<number | undefined>((sibling ?? others[0])?.id);
  const [err, setErr] = useState<string | null>(null);
  const { busy, run } = useBusy();
  const id = (k: string) => 'ct-' + mode + '-' + k;
  const target = to === 'parent' ? parent : to === 'other' ? byId.get(other ?? -1) : undefined;
  const used = rules.filter((r) => r.categoryId === c.id).length;

  let ruleNote = '';
  if (used) {
    const t = target ? 'kiest voortaan ' + target.name : null;
    ruleNote =
      used === 1
        ? 'Je 1 regel kiest ' + c.name + '. ' + (t ? 'Die ' + t + '.' : 'Die regel wordt verwijderd.')
        : 'Je ' + used + ' regels kiezen ' + c.name + '. ' + (target ? 'Die kiezen voortaan ' + target.name + '.' : 'Die regels worden verwijderd.');
  }
  const q = c.count ? 'Waar gaan je ' + plural(c.count, 'transactie', 'transacties') + ' naartoe?' : 'Je hebt geen transacties in ' + c.name + '. Kies waar die van andere gebruikers naartoe gaan.';
  const sub = (parent ? parent.name + ' › ' + c.name : c.name) + (counts ? ' · ' + plural(c.count, 'transactie', 'transacties') + ' van jou' : '');

  const confirm = () =>
    run(async () => {
      setErr(null);
      try {
        await api.deleteCategory(c.id, target ? target.id : 'none');
        toast(c.name + ' verwijderd' + (c.count ? (target ? ' · ' + c.count + ' naar ' + target.name : ' · ' + c.count + ' zonder categorie') : ''));
        onDone(target ?? null);
      } catch (e) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) setErr(e.message);
        else toast(errorMessage(e));
      }
    });

  const radio = (val: typeof to, title: string, subText: string, extra?: ReactNode) => (
    <div className={'ct-radio-box' + (to === val ? ' is-on' : '')}>
      <label className="ct-radio">
        <input type="radio" name={id('to')} value={val} checked={to === val} onChange={() => setTo(val)} data-key={'to-' + val} />
        <span className="ct-radio-text">
          <span className="ct-radio-title">{title}</span>
          {subText && <span className="ct-radio-sub">{subText}</span>}
        </span>
      </label>
      {extra}
    </div>
  );

  return (
    <div className="ct-editor">
      <Head look={{ bg: 'var(--negSoft)', fg: 'var(--negText)' }} icon="trash" title={c.name + ' verwijderen'} sub={sub} inSheet={mode === 'p'} onClose={onClose} />
      <fieldset className="ct-fieldset">
        <legend className="ct-q">{q}</legend>
        <div className="ct-radios">
          {parent && radio('parent', 'Naar ' + parent.name, 'De hoofdcategorie')}
          {others.length > 0 &&
            radio(
              'other',
              'Naar een andere categorie',
              '',
              <>
                <label className="visually-hidden" htmlFor={id('other')}>
                  Andere categorie
                </label>
                <Select
                  className="ct-radio-select"
                  id={id('other')}
                  value={String(other)}
                  disabled={to !== 'other'}
                  onChange={(v) => setOther(Number(v))}
                  options={others.map((x) => ({ value: String(x.id), label: categoryLabel(x, byId) }))}
                />
              </>,
            )}
          {radio('none', 'Niet gecategoriseerd', 'Ze komen bij Te categoriseren in Transacties')}
        </div>
      </fieldset>
      {ruleNote && <p className="ct-box">{ruleNote}</p>}
      <p className="ct-help">Transacties van andere gebruikers in {c.name} gaan naar dezelfde plaats. Hoeveel dat er zijn, zie je niet.</p>
      {err && (
        <p className="ct-form-err" role="alert">
          {err}
        </p>
      )}
      <div className="ct-actions">
        <button type="button" className="ct-btn ct-btn--ghost" data-key="cancel-del" onClick={onCancel}>
          Annuleren
        </button>
        <button type="button" className="ct-btn ct-btn--dangerfill" data-key="confirm-del" disabled={!online || busy} aria-busy={busy || undefined} onClick={() => void confirm()}>
          Verwijderen
        </button>
      </div>
      <Offline />
    </div>
  );
}

// ---------- Rules ----------

/** "Al je persoonlijke rekeningen" or the account's name. */
export function ownerLong(accountId: number | null, accounts: Account[]): string {
  if (accountId === null) return 'Al je persoonlijke rekeningen';
  return accounts.find((a) => a.id === accountId)?.name ?? 'Rekening';
}

function ownerHelp(accountId: number | null, accounts: Account[]): string {
  if (accountId === null) return 'Alleen voor jou. Geldt voor al je rekeningen waar jij het enige lid bent.';
  const a = accounts.find((x) => x.id === accountId);
  if (!a) return '';
  if (!isShared(a)) return 'Geldt alleen voor ' + a.name + '.';
  const editors = others(a)
    .filter((m) => m.permission === 'edit')
    .map((m) => m.name);
  return 'Geldt voor ' + a.name + '.' + (editors.length ? ' Leden met Bewerken, zoals ' + names(editors) + ', zien en wijzigen deze regel ook.' : '');
}

/** A typed rule amount: cents, `null` when empty, NaN when it is not an amount without sign. */
export function ruleAmount(s: string): number | null {
  if (!s.trim()) return null;
  const n = parseMoney(s);
  return Number.isNaN(n) || n < 0 ? NaN : n;
}

const amountIn = (c: number | null) => (c === null ? '' : c % 100 ? (c / 100).toFixed(2).replace('.', ',') : String(c / 100));

export interface RuleDraft {
  exact: boolean;
  cp: string;
  iban: string;
  comm: string;
  regex: boolean;
  minIn: string;
  maxIn: string;
  categoryId: number | null;
  /** null: a user rule. */
  accountId: number | null;
  apply: boolean;
}

export function draftOf(r: Rule | null, from?: Suggestion): RuleDraft {
  if (r) {
    return {
      exact: r.counterpartyExact,
      cp: r.counterparty ?? '',
      iban: r.counterpartyIban ?? '',
      comm: r.communication ?? '',
      regex: r.communicationRegex,
      minIn: amountIn(r.amountMin),
      maxIn: amountIn(r.amountMax),
      categoryId: r.categoryId,
      accountId: r.accountId,
      apply: false,
    };
  }
  return { exact: !!from, cp: from?.counterparty ?? '', iban: '', comm: '', regex: false, minIn: '', maxIn: '', categoryId: from?.categoryId ?? null, accountId: null, apply: !!from };
}

const hasCondition = (d: RuleDraft) => !!(d.cp.trim() || d.iban.trim() || d.comm.trim() || d.minIn.trim() || d.maxIn.trim());

/**
 * The body for the API. The IBAN of a stored rule only comes back masked: unchanged it is left out (a PATCH
 * and the preview, which gets `ruleId`, use the stored one; `ibanHidden`), emptied it is cleared.
 */
export function inputOf(d: RuleDraft, r: Rule | null): { input: RuleInput; ibanHidden: boolean } {
  const min = ruleAmount(d.minIn);
  const max = ruleAmount(d.maxIn);
  const input: RuleInput = {
    counterparty: d.cp.trim() || null,
    counterpartyExact: d.exact,
    communication: d.comm.trim() || null,
    communicationRegex: d.regex,
    amountMin: min,
    amountMax: max,
  };
  const ibanHidden = !!r?.counterpartyIban && d.iban === r.counterpartyIban;
  if (!ibanHidden) input.counterpartyIban = d.iban.trim() || null;
  if (d.categoryId !== null) input.categoryId = d.categoryId;
  if (!r) input.accountId = d.accountId;
  return { input, ibanHidden };
}

/** The preview line of the mockup's preview(), from the server's answer. */
export function previewText(p: RulePreview, hasCategory: boolean): string {
  if (!p.matches) return 'Past nog op geen enkele transactie. Nieuwe transacties die passen, krijgen deze categorie.';
  const main = 'Past op ' + plural(p.matches, 'transactie', 'transacties');
  if (!hasCategory) return main + ' · kies een categorie';
  const skipped = skippedText(p.skipped);
  const parts = [main];
  if (p.changes) parts.push(p.changes + (p.changes === 1 ? ' krijgt' : ' krijgen') + ' een andere categorie');
  if (skipped) parts.push(skipped);
  if (!p.changes && !skipped) parts.push('ze hebben deze categorie al');
  return parts.join(' · ');
}

type PreviewState = { kind: 'idle'; text: string } | { kind: 'ok'; text: string; tone: '' | 'idle' } | { kind: 'bad'; text: string } | { kind: 'neterr' };

const IDLE = 'Vul minstens één voorwaarde in.';

interface RuleEditorProps {
  mode: Mode;
  /** null: a new rule. */
  rule: Rule | null;
  from?: Suggestion;
  rules: Rule[];
  tree: TreeCategory[];
  accounts: Account[];
  /** After a save: the rule and, when its place changed, the new list. */
  onSaved: (r: Rule, list: Rule[] | null, applied: boolean) => void;
  onDeleted: (id: number) => void;
  /** The list of rules changed meanwhile (a stale reorder): load it again. */
  onStale: () => void;
  onClose: () => void;
}

export function RuleEditor({ mode, rule: r, from, rules, tree, accounts, onSaved, onDeleted, onStale, onClose }: RuleEditorProps) {
  const { online, toast } = useApp();
  const [d, setD] = useState<RuleDraft>(() => draftOf(r, from));
  const editable = rules.filter((x) => x.permission === 'edit');
  const slot = r ? editable.findIndex((x) => x.id === r.id) : -1;
  const [prio, setPrio] = useState(slot);
  const [err, setErr] = useState<{ cond?: string; amt?: string; comm?: string; cat?: string; form?: string }>({});
  const [pv, setPv] = useState<PreviewState>({ kind: 'idle', text: IDLE });
  const [retry, setRetry] = useState(0);
  const { busy, run } = useBusy();
  const root = useRef<HTMLDivElement>(null);
  const id = (k: string) => 'ct-' + mode + '-' + k;
  const byId = new Map(tree.map((x) => [x.id, x]));
  const cat = d.categoryId === null ? undefined : byId.get(d.categoryId);
  const look: Look = cat ? catColours(cat.colour) : { bg: 'var(--bg)', fg: 'var(--muted)' };
  const pos = r ? rules.findIndex((x) => x.id === r.id) + 1 : 0;
  const title = r ? 'Regel ' + pos : from ? 'Regel uit suggestie' : 'Nieuwe regel';
  const set = (patch: Partial<RuleDraft>) => {
    setD((x) => ({ ...x, ...patch }));
    setErr((e) => ({ ...e, cond: undefined, form: undefined, ...('comm' in patch || 'regex' in patch ? { comm: undefined } : {}), ...('minIn' in patch || 'maxIn' in patch ? { amt: undefined } : {}), ...('categoryId' in patch ? { cat: undefined } : {}) }));
  };

  // Live preview: debounced, the stale request aborted.
  const { input, ibanHidden } = inputOf(d, r);
  const amountsOk = !Number.isNaN(input.amountMin) && !Number.isNaN(input.amountMax);
  const body = hasCondition(d) && amountsOk ? JSON.stringify({ ...input, accountId: d.accountId, ...(r ? { ruleId: r.id } : {}) }) : null;
  const idleText = !hasCondition(d) ? IDLE : 'Vul een bedrag in euro in, bijvoorbeeld 20 of 19,99.';
  useEffect(() => {
    if (!body) {
      setPv({ kind: 'idle', text: idleText });
      return;
    }
    const ctl = new AbortController();
    const t = window.setTimeout(() => {
      api.previewRule(JSON.parse(body), ctl.signal).then(
        (p) => {
          setPv({ kind: 'ok', text: previewText(p, JSON.parse(body).categoryId != null), tone: p.matches ? '' : 'idle' });
          setErr((e) => (e.comm === BAD_REGEX ? { ...e, comm: undefined } : e));
        },
        (e) => {
          if (isAbort(e) || ctl.signal.aborted) return;
          if (e instanceof ApiError && e.status === 400) {
            if (e.message === BAD_REGEX) setErr((x) => ({ ...x, comm: BAD_REGEX }));
            setPv({ kind: 'bad', text: e.message });
          } else setPv({ kind: 'neterr' });
        },
      );
    }, 300);
    return () => {
      window.clearTimeout(t);
      ctl.abort();
    };
  }, [body, retry, idleText]);

  const save = () =>
    run(async () => {
      const e: typeof err = {};
      if (!amountsOk) e.amt = 'Vul een bedrag in euro in, bijvoorbeeld 20 of 19,99.';
      else if (input.amountMin !== null && input.amountMax !== null && input.amountMin! > input.amountMax!) e.amt = 'Het eerste bedrag moet kleiner zijn dan het tweede.';
      if (!hasCondition(d)) e.cond = IDLE;
      if (d.categoryId === null) e.cat = 'Kies een categorie.';
      if (err.comm === BAD_REGEX && d.regex) e.comm = BAD_REGEX;
      if (Object.keys(e).length) {
        setErr(e);
        focusFirst(root.current, [e.cond && 'cp', e.comm && 'comm', e.amt && 'min', e.cat && 'cat'].filter(Boolean) as string[]);
        return;
      }
      let saved: Rule;
      try {
        saved = r ? await api.updateRule(r.id, input) : await api.createRule(input);
      } catch (x) {
        if (x instanceof ApiError && x.message === BAD_REGEX) {
          setErr({ comm: BAD_REGEX });
          focusFirst(root.current, ['comm']);
        } else if (x instanceof ApiError && x.status === 400) setErr({ form: x.message });
        else toast(errorMessage(x));
        return;
      }
      let list: Rule[] | null = null;
      const notes: string[] = [];
      if (r && prio !== slot && prio >= 0) {
        const ids = editable.map((x) => x.id).filter((x) => x !== r.id);
        ids.splice(prio, 0, r.id);
        try {
          list = await api.reorderRules(ids);
        } catch (x) {
          notes.push(errorMessage(x));
          if (x instanceof ApiError && x.status === 400) onStale();
        }
      }
      let applied = false;
      let text = r ? 'Regel opgeslagen' : 'Regel gemaakt';
      if (d.apply) {
        try {
          const res = await api.applyRule(saved.id);
          applied = true;
          const skipped = skippedText(res.skipped);
          if (res.updated) text += ' · ' + res.updated + ' bijgewerkt';
          if (skipped) text += ' · ' + skipped;
        } catch (x) {
          notes.push(errorMessage(x));
        }
      }
      toast([text, ...notes].join(' · '));
      onSaved(saved, list, applied);
    });

  const remove = () =>
    run(async () => {
      if (!r) return;
      try {
        await api.deleteRule(r.id);
        toast('Regel verwijderd');
        onDeleted(r.id);
      } catch (x) {
        toast(errorMessage(x));
      }
    });

  const owners = accounts.filter((a) => a.type === 'current' || a.id === d.accountId);
  const prioOpts = editable.map((x, i) => {
    const n = rules.findIndex((y) => y.id === x.id) + 1;
    return { i, label: n + (i === 0 ? ' · hoogste' : i === editable.length - 1 && editable.length > 1 ? ' · laagste' : '') };
  });
  const pvClass = 'ct-preview' + (pv.kind === 'idle' || (pv.kind === 'ok' && pv.tone === 'idle') || pv.kind === 'neterr' ? ' ct-preview--idle' : pv.kind === 'bad' ? ' ct-preview--bad' : '');

  return (
    <div className="ct-editor" ref={root}>
      <Head look={look} icon="filter" title={title} sub={ownerLong(d.accountId, accounts) + (r ? ' · prioriteit ' + pos : '')} inSheet={mode === 'p'} onClose={onClose} />
      <fieldset className="ct-fieldset">
        <legend className="ct-legend">Voorwaarden</legend>
        <span className="ct-help ct-legend-help">Alle ingevulde voorwaarden moeten kloppen.</span>
        <div className="ct-field">
          <div className="ct-label-row">
            <label className="ct-label" htmlFor={id('cp')}>
              Tegenpartij
            </label>
            <div className="ct-seg" role="group" aria-label="Tegenpartij vergelijken">
              <button type="button" aria-pressed={!d.exact} onClick={() => set({ exact: false })}>
                bevat
              </button>
              <button type="button" aria-pressed={d.exact} onClick={() => set({ exact: true })}>
                is gelijk aan
              </button>
            </div>
          </div>
          <input
            className="input"
            id={id('cp')}
            autoComplete="off"
            maxLength={140}
            placeholder="Bijvoorbeeld: Colruyt"
            value={d.cp}
            data-key="cp"
            onChange={(e) => set({ cp: e.target.value })}
            {...invalid(id('cond-err'), err.cond)}
          />
        </div>
        <div className="ct-field">
          <label className="ct-label" htmlFor={id('iban')}>
            IBAN tegenpartij
          </label>
          <input
            className="input ct-mono"
            id={id('iban')}
            autoComplete="off"
            spellCheck={false}
            maxLength={42}
            placeholder="BE00 0000 0000 0000"
            value={d.iban}
            onChange={(e) => set({ iban: e.target.value })}
            aria-describedby={ibanHidden ? id('iban-help') : undefined}
          />
          {ibanHidden && (
            <span className="ct-help" id={id('iban-help')}>
              Saldo toont een IBAN nooit voluit. Laat het staan om het te houden.
            </span>
          )}
        </div>
        <div className="ct-field">
          <div className="ct-label-row">
            <label className="ct-label" htmlFor={id('comm')}>
              Mededeling
            </label>
            <span className="ct-sw">
              <span id={id('re-l')}>Reguliere expressie</span>
              <button type="button" className="switch ct-switch" role="switch" aria-checked={d.regex} aria-labelledby={id('re-l')} onClick={() => set({ regex: !d.regex })} />
            </span>
          </div>
          <input
            className={'input' + (d.regex ? ' ct-mono' : '')}
            id={id('comm')}
            autoComplete="off"
            maxLength={200}
            placeholder={d.regex ? 'netflix|spotify' : 'Bijvoorbeeld: bijdrage'}
            value={d.comm}
            data-key="comm"
            onChange={(e) => set({ comm: e.target.value })}
            {...invalid(id('comm-err'), err.comm)}
          />
          <Err id={id('comm-err')} msg={err.comm} />
          <span className="ct-help">{d.regex ? 'Een reguliere expressie, bijvoorbeeld netflix|spotify. Hoofdletters tellen niet mee.' : 'Bevat deze tekst. Hoofdletters tellen niet mee.'}</span>
        </div>
        <div className="ct-field">
          <span className="ct-label" id={id('amt-l')}>
            Bedrag
          </span>
          <div className="ct-amounts" role="group" aria-labelledby={id('amt-l')}>
            <span className="ct-money">
              <span aria-hidden="true">€</span>
              <input
                className="input ct-money-input"
                inputMode="decimal"
                autoComplete="off"
                placeholder="van"
                aria-label="Bedrag van"
                value={d.minIn}
                data-key="min"
                onChange={(e) => set({ minIn: e.target.value })}
                {...invalid(id('amt-err'), err.amt)}
              />
            </span>
            <span className="ct-amounts-sep" aria-hidden="true">
              tot
            </span>
            <span className="ct-money">
              <span aria-hidden="true">€</span>
              <input
                className="input ct-money-input"
                inputMode="decimal"
                autoComplete="off"
                placeholder="tot"
                aria-label="Bedrag tot"
                value={d.maxIn}
                onChange={(e) => set({ maxIn: e.target.value })}
                {...invalid(id('amt-err'), err.amt)}
              />
            </span>
          </div>
          <Err id={id('amt-err')} msg={err.amt} />
          <span className="ct-help">Zonder teken: Saldo vergelijkt met het bedrag zonder plus of min, voor uitgaven en inkomsten.</span>
        </div>
      </fieldset>
      <fieldset className="ct-fieldset">
        <legend className="ct-legend">Resultaat</legend>
        <div className="ct-field">
          <label className="ct-label" htmlFor={id('cat')}>
            Categorie
          </label>
          <Select
            id={id('cat')}
            value={d.categoryId === null ? '' : String(d.categoryId)}
            dataKey="cat"
            onChange={(v) => set({ categoryId: v ? Number(v) : null })}
            invalid={!!err.cat}
            describedBy={err.cat ? id('cat-err') : undefined}
            options={[
              { value: '', label: 'Kies een categorie' },
              ...(['expense', 'income'] as const).flatMap((type) =>
                tree.filter((x) => x.type === type).map((x) => ({ value: String(x.id), label: categoryLabel(x, byId), group: type === 'expense' ? 'Uitgaven' : 'Inkomsten' })),
              ),
            ]}
          />
          <Err id={id('cat-err')} msg={err.cat} />
        </div>
        <div className="ct-field">
          <label className="ct-label" htmlFor={id('owner')}>
            Geldt voor
          </label>
          <Select
            id={id('owner')}
            value={d.accountId === null ? '' : String(d.accountId)}
            disabled={!!r}
            describedBy={id('owner-help')}
            onChange={(v) => set({ accountId: v ? Number(v) : null })}
            options={[
              { value: '', label: 'Al je persoonlijke rekeningen' },
              ...owners.map((a) => ({
                value: String(a.id),
                label: a.name + (isShared(a) && others(a).length ? ' · met ' + names(others(a).map((m) => m.name)) : '') + (a.permission !== 'edit' ? ' (alleen lezen)' : ''),
                disabled: a.permission !== 'edit',
              })),
            ]}
          />
          <span className="ct-help" id={id('owner-help')}>
            {ownerHelp(d.accountId, accounts)}
            {r && ' Voor wie een regel geldt, verandert niet: maak daarvoor een nieuwe regel.'}
          </span>
        </div>
        {r && slot >= 0 && (
          <div className="ct-field">
            <label className="ct-label" htmlFor={id('prio')}>
              Prioriteit
            </label>
            <Select id={id('prio')} value={String(prio)} onChange={(v) => setPrio(Number(v))} options={prioOpts.map((o) => ({ value: String(o.i), label: o.label }))} />
            <span className="ct-help">1 is de hoogste. Passen twee regels op dezelfde transactie, dan wint de hoogste.</span>
          </div>
        )}
      </fieldset>
      {err.cond && (
        <p className="ct-err" id={id('cond-err')}>
          {err.cond}
        </p>
      )}
      <div className={pvClass} role="status">
        <Icon name="search" size={16} stroke={2.4} />
        {pv.kind === 'neterr' ? (
          <>
            <span>Het voorbeeld laden lukt niet.</span>
            <button type="button" className="ct-preview-retry" onClick={() => setRetry((n) => n + 1)}>
              Opnieuw
            </button>
          </>
        ) : (
          <span>{pv.text}</span>
        )}
      </div>
      <label className="ct-check">
        <input type="checkbox" checked={d.apply} onChange={(e) => setD((x) => ({ ...x, apply: e.target.checked }))} />
        <span>
          <strong>Ook toepassen op bestaande transacties</strong>
          <br />
          <span className="muted">(handmatige keuzes, imports en splitsingen blijven staan)</span>
        </span>
      </label>
      {err.form && (
        <p className="ct-form-err" role="alert">
          {err.form}
        </p>
      )}
      <div className="ct-actions">
        {r ? (
          <button type="button" className="ct-btn ct-btn--danger" disabled={!online || busy} onClick={() => void remove()}>
            <Icon name="trash" size={16} stroke={2.2} />
            Verwijderen
          </button>
        ) : (
          <button type="button" className="ct-btn ct-btn--ghost" onClick={onClose}>
            Annuleren
          </button>
        )}
        <button type="button" className="ct-btn ct-btn--primary" data-key="save" disabled={!online || busy} aria-busy={busy || undefined} onClick={() => void save()}>
          Opslaan
        </button>
      </div>
      {r && <span className="ct-help">Verwijder je een regel, dan houden transacties de categorie die ze ervan kregen.</span>}
      <Offline />
    </div>
  );
}

export function RuleView({ mode, rule: r, rules, tree, accounts, onClose }: { mode: Mode; rule: Rule; rules: Rule[]; tree: TreeCategory[]; accounts: Account[]; onClose: () => void }) {
  const byId = new Map(tree.map((x) => [x.id, x]));
  const c = byId.get(r.categoryId);
  const pos = rules.findIndex((x) => x.id === r.id) + 1;
  const a = accounts.find((x) => x.id === r.accountId);
  const mgr = a ? manager(a) : undefined;
  return (
    <div className="ct-editor">
      <Head
        look={c ? catColours(c.colour) : catColours('soft')}
        icon="filter"
        title={'Regel ' + pos}
        sub={ownerLong(r.accountId, accounts) + ' · prioriteit ' + pos}
        inSheet={mode === 'p'}
        onClose={onClose}
        extra={<ReadOnlyChip head />}
      />
      <dl className="ct-dl">
        <dt>Voorwaarden</dt>
        <dd>
          {ruleConditions(r).map((x, i) => (
            <span key={i}>
              {i > 0 && <br />}
              {x}
            </span>
          ))}
        </dd>
        <dt>Categorie</dt>
        <dd>
          <CatChip c={c} byId={byId} />
        </dd>
        <dt>Geldt voor</dt>
        <dd>
          <OwnerChip accountId={r.accountId} accounts={accounts} />
        </dd>
        <dt>Prioriteit</dt>
        <dd>
          {pos} van {rules.length}
        </dd>
      </dl>
      <p className="ct-box">
        {(mgr && !mgr.me ? mgr.name : 'De beheerder') + ' beheert ' + (a ? a.name : 'deze rekening') + ' en gaf je Lezen. Je ziet deze regel, maar wijzigen kan alleen met Bewerken.'}
      </p>
      {mode === 'p' && (
        <button type="button" className="ct-btn ct-btn--ghost" onClick={onClose}>
          Sluiten
        </button>
      )}
    </div>
  );
}
