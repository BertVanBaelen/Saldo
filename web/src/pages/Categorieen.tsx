// Categorieën en regels: the category tree shared by all users, the viewer's rules by priority and the
// suggestions to confirm. Phone: a Meer sub page with bottom sheets; desktop: list with a side panel editor.
// Design: finance-mockup/js/screens/categorieen.js; spec: analysis/screens/categorieen.md.
// Deep links: ?tab=categorieen|regels|suggesties and &regel=<id> (opens that rule).
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { Icon, type IconName } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { delay, ErrorState, Skel, SkelList, useIsDesktop, useTitle } from '../components/ui';
import { api, ApiError, errorMessage } from '../lib/api';
import { catColours, plural, ruleConditions, ruleLabel } from '../lib/categories';
import type { Rule, Suggestion, TreeCategory } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { categoryIcon } from '../lib/categoryIcons';
import { BackfillSheet } from './CategorieenBackfill';
import { CatChip, CatEditor, DelEditor, Info, OwnerChip, ReadOnlyChip, RuleEditor, RuleView } from './CategorieenEditors';
import './Categorieen.css';

const TABS = [
  ['categorieen', 'Categorieën'],
  ['regels', 'Regels'],
  ['suggesties', 'Suggesties'],
] as const;
type Tab = (typeof TABS)[number][0];

type Ed =
  | { kind: 'info' }
  | { kind: 'cat'; id: number | null; parentId?: number }
  | { kind: 'del'; id: number }
  | { kind: 'rule'; id: number | null; from?: Suggestion };

const lower = (s: string) => (s.startsWith('IBAN') ? s : s.charAt(0).toLowerCase() + s.slice(1));

function Note({ icon, title, text }: { icon: IconName; title: string; text?: string }) {
  return (
    <div className="ct-note anim-in" style={delay(30)}>
      <span className="ct-note-icon">
        <Icon name={icon} size={18} stroke={2.2} />
      </span>
      <span className="ct-note-text">
        <strong>{title}</strong>
        {text && <span>{text}</span>}
      </span>
    </div>
  );
}

function EmptyCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="ct-empty anim-in" style={delay(60)}>
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function OfflineLine() {
  return (
    <p className="ct-offline">
      <Icon name="cloudOff" size={16} stroke={2.2} />
      <span>Je bent offline. Wijzigen kan weer zodra je verbinding hebt.</span>
    </p>
  );
}

const Chevron = () => (
  <span className="ct-chev">
    <Icon name="chevron" size={16} stroke={2.2} />
  </span>
);

function Skeleton() {
  return (
    <div className="ct-layout" role="status" aria-label="Categorieën en regels laden">
      <div className="ct-col">
        <Skel w="100%" h={56} />
        <SkelList rows={4} />
      </div>
      <div className="only-desktop">
        <div className="ct-panel ct-skel-panel">
          <Skel w="60%" h={17} />
          <Skel w="100%" h={44} />
          <Skel w="100%" h={44} />
        </div>
      </div>
    </div>
  );
}

export function Categorieen() {
  useTitle('Categorieën en regels');
  const { online, toast, dataVersion, refreshShell } = useApp();
  const desktop = useIsDesktop();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = TABS.some((t) => t[0] === tabParam) ? (tabParam as Tab) : 'categorieen';

  const cats = useAsync((signal) => api.categories(signal), [dataVersion]);
  const rules = useAsync((signal) => api.rules(signal), [dataVersion]);
  const sugg = useAsync((signal) => api.suggestions(signal), [dataVersion]);
  const accounts = useAsync((signal) => api.accounts(signal), [dataVersion]);
  const tree = cats.data;
  const ruleList = rules.data;
  const accs = accounts.data ?? [];
  const byId = new Map((tree ?? []).map((c) => [c.id, c]));

  // `ed` is what the user opened; without it the panel shows the tab's default (as the mockup's defaultEd).
  const [ed, setEd] = useState<Ed | null>(null);
  const [sheet, setSheet] = useState(false);
  const [backfill, setBackfill] = useState(false);
  const [selCat, setSelCat] = useState<number | null>(null);
  const [selRule, setSelRule] = useState<number | null>(null);
  const [live, setLive] = useState('');
  const page = useRef<HTMLDivElement>(null);
  const focusKey = useRef<string | null>(null);
  const focusTries = useRef(0);
  const focusPanel = useRef(false);
  const opener = useRef<string | null>(null);
  const moving = useRef(false);
  const busySugg = useRef(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const announce = (text: string) => {
    setLive('');
    window.setTimeout(() => setLive(text), 30);
  };

  // Keyboard focus after a change: on a list control (data-key) or into the desktop panel.
  useLayoutEffect(() => {
    if (focusKey.current) {
      const el = page.current?.querySelector<HTMLElement>('[data-key="' + focusKey.current + '"]') ?? document.querySelector<HTMLElement>('.ct-sheet [data-key="' + focusKey.current + '"]');
      if (el && !(el as HTMLButtonElement).disabled) el.focus();
      // A saved row may appear only after the reload: try a few renders, then give up.
      if (el || ++focusTries.current > 5) {
        focusKey.current = null;
        focusTries.current = 0;
      }
    }
    if (focusPanel.current) {
      focusPanel.current = false;
      const panel = document.getElementById('ct-panel');
      (panel?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled])') ?? panel?.querySelector<HTMLElement>('button:not([disabled])'))?.focus();
    }
  });

  // Another editor in the desktop panel starts at its top.
  const shownKey = JSON.stringify(ed);
  useLayoutEffect(() => {
    const panel = document.getElementById('ct-panel');
    if (panel) panel.scrollTop = 0;
  }, [shownKey]);

  // Crossing the breakpoint: an open sheet becomes the side panel.
  useEffect(() => {
    if (desktop && sheet) setSheet(false);
  }, [desktop, sheet]);

  // ?regel=<id> (from Transacties "Regel aanpassen" or the toast "Regel openen"): open that rule once the list
  // has it. Closing the editor drops the param, so the same rule can be opened again later.
  const regelParam = params.get('regel');
  const handledRegel = useRef<string | null>(null);
  useEffect(() => {
    if (!regelParam) handledRegel.current = null;
    if (!regelParam || !ruleList || handledRegel.current === regelParam) return;
    const r = ruleList.find((x) => x.id === Number(regelParam));
    if (r) {
      handledRegel.current = regelParam;
      opener.current = 'rule-' + r.id;
      setSelRule(r.id);
      setEd({ kind: 'rule', id: r.id });
      setSheet(true);
    }
  }, [regelParam, ruleList]);

  const firstTop = tree?.find((c) => c.parentId === null);
  const defaultEd = (): Ed => {
    if (tab === 'categorieen') {
      const id = selCat !== null && byId.has(selCat) ? selCat : firstTop?.id;
      return id !== undefined ? { kind: 'cat', id } : { kind: 'info' };
    }
    if (tab === 'regels' && ruleList?.length) return { kind: 'rule', id: selRule !== null && ruleList.some((r) => r.id === selRule) ? selRule : ruleList[0].id };
    return { kind: 'info' };
  };
  const shown: Ed = ed ?? defaultEd();

  const setTab = (t: Tab) => {
    focusKey.current = 'tab-' + t;
    if (t === tab) return;
    setEd(null);
    setSheet(false);
    setParams({ tab: t }, { replace: true });
  };

  /** Show an editor: the desktop panel, or the phone sheet. `key` is the control to return to. */
  const open = (next: Ed, key: string | null, intoPanel = false) => {
    if (next.kind === 'cat' && next.id !== null) setSelCat(next.id);
    if (next.kind === 'del') setSelCat(next.id);
    if (next.kind === 'rule' && next.id !== null) setSelRule(next.id);
    if (key) opener.current = key;
    setEd(next);
    if (!desktop) {
      if (sheet) focusKey.current = 'close';
      setSheet(true);
    } else if (intoPanel) focusPanel.current = true;
  };

  /** Leave an editor; focus goes back to `key` (default: the control that opened it). */
  const close = (key?: string | null) => {
    setEd(null);
    setSheet(false);
    focusKey.current = key === undefined ? opener.current : key;
    if (params.has('regel')) {
      const n = new URLSearchParams(params);
      n.delete('regel');
      setParams(n, { replace: true });
    }
  };

  /** After a save: the phone sheet closes, the desktop panel shows `next`. */
  const done = (next: Ed, key: string) => {
    if (!desktop) close(key);
    else {
      setEd(next);
      focusKey.current = key;
    }
  };

  // ---------- Header and tabs ----------

  const add: [string, () => void] | null =
    tab === 'categorieen' ? ['Categorie toevoegen', () => open({ kind: 'cat', id: null }, 'head-add', true)] : tab === 'regels' ? ['Regel toevoegen', () => open({ kind: 'rule', id: null }, 'head-add', true)] : null;
  const header = (
    <div className="ct-head anim-fade">
      <Link className="page-back only-phone" to="/meer" aria-label="Terug naar Meer">
        <Icon name="back" size={22} stroke={2.4} />
      </Link>
      <div className="ct-head-title">
        <h1>Categorieën en regels</h1>
        <span className="ct-head-sub only-desktop">Eén lijst categorieën voor iedereen, regels voor jouw rekeningen</span>
      </div>
      {desktop && add && (
        <div className="only-desktop">
          <button type="button" className="btn btn--primary ct-add" data-key="head-add" onClick={add[1]}>
            <Icon name="plus" size={16} stroke={2.6} />
            {add[0]}
          </button>
        </div>
      )}
    </div>
  );

  const counts: Partial<Record<Tab, number>> = { regels: ruleList?.length, suggesties: sugg.data?.length };
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = { ArrowLeft: (i + TABS.length - 1) % TABS.length, ArrowRight: (i + 1) % TABS.length, Home: 0, End: TABS.length - 1 }[e.key];
    if (n === undefined) return;
    e.preventDefault();
    setTab(TABS[n][0]);
    if (TABS[n][0] === tab) page.current?.querySelector<HTMLElement>('[data-key="tab-' + tab + '"]')?.focus();
  };
  const tabs = (
    <div className="ct-tabs anim-fade" style={delay(20)} role="tablist" aria-label="Categorieën en regels">
      {TABS.map(([key, label], i) => {
        const on = key === tab;
        const n = counts[key];
        return (
          <button
            key={key}
            type="button"
            role="tab"
            className="ct-tab"
            id={'ct-tab-' + key}
            aria-selected={on}
            aria-controls="ct-tabpanel"
            tabIndex={on ? 0 : -1}
            data-key={'tab-' + key}
            onClick={() => setTab(key)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {label}
            {!!n && <span className={'ct-tab-count' + (key === 'suggesties' ? '' : ' ct-tab-count--muted')}>{n}</span>}
          </button>
        );
      })}
    </div>
  );

  // ---------- Categorieën ----------

  const hasTx = accs.length > 0;
  const catTab = () => {
    const list = tree!;
    const selId = desktop && (shown.kind === 'cat' || shown.kind === 'del') ? shown.id : null;
    const kids = (id: number) => list.filter((c) => c.parentId === id);
    const row = (c: TreeCategory, sub: boolean) => {
      const lk = catColours(c.colour);
      const k = kids(c.id).length;
      const n = sub ? c.count : c.count + kids(c.id).reduce((s, x) => s + x.count, 0);
      const subline = sub ? '' : k ? plural(k, 'subcategorie', 'subcategorieën') : c.type === 'expense' ? 'Geen subcategorieën' : '';
      return (
        <button
          key={c.id}
          type="button"
          className={'ct-crow' + (sub ? ' ct-crow--sub' : '')}
          data-key={'cat-' + c.id}
          aria-pressed={desktop ? selId === c.id : undefined}
          aria-haspopup={desktop ? undefined : 'dialog'}
          onClick={() => {
            if (desktop && shown.kind === 'cat' && shown.id === c.id) return;
            open({ kind: 'cat', id: c.id }, 'cat-' + c.id);
          }}
        >
          <span className={'ct-cav' + (sub ? ' ct-cav--sub' : '')} style={{ background: lk.bg, color: lk.fg }}>
            <Icon name={categoryIcon(c.icon)} size={sub ? 13 : 16} stroke={2.2} />
          </span>
          <span className="ct-crow-main">
            <span className="ct-crow-name">{c.name}</span>
            {subline && (
              <span className="ct-crow-sub">
                <span className="visually-hidden">, </span>
                {subline}
              </span>
            )}
          </span>
          {hasTx && (
            <span className="mono ct-count">
              <span className="visually-hidden">, </span>
              {n}
              <span className="visually-hidden"> {n === 1 ? 'transactie' : 'transacties'}</span>
            </span>
          )}
          <Chevron />
        </button>
      );
    };
    const group = (type: TreeCategory['type'], title: string, ms: number) => {
      const tops = list.filter((c) => c.parentId === null && c.type === type);
      return (
        <section className="ct-group anim-in" style={delay(ms)} aria-labelledby={'ct-g-' + type}>
          <div className="ct-group-head">
            <h2 className="label" id={'ct-g-' + type}>
              {title}
            </h2>
            <span className="ct-group-note">· {plural(tops.length, type === 'expense' ? 'hoofdcategorie' : 'categorie', type === 'expense' ? 'hoofdcategorieën' : 'categorieën')}</span>
            {hasTx && (
              <span className="ct-group-right" aria-hidden="true">
                Jouw transacties
              </span>
            )}
          </div>
          {tops.length > 0 && <div className="ct-list">{tops.flatMap((c) => [row(c, false), ...kids(c.id).map((k) => row(k, true))])}</div>}
        </section>
      );
    };
    return (
      <>
        <Note
          icon="people"
          title="Gedeeld met alle gebruikers · alleen namen, nooit bedragen"
          text={hasTx ? 'De aantallen tellen alleen jouw eigen transacties.' : 'Nog geen transacties. De aantallen verschijnen zodra je een rekening koppelt of importeert.'}
        />
        {list.length ? (
          <>
            {group('expense', 'Uitgaven', 60)}
            {group('income', 'Inkomsten', 90)}
          </>
        ) : (
          <EmptyCard title="Nog geen categorieën" text="Voeg een categorie toe, dan kun je transacties ordenen. Ze geldt meteen voor alle gebruikers." />
        )}
        <button type="button" className="btn btn--dashed btn--block only-phone ct-add-phone anim-in" style={delay(110)} data-key="add-cat" aria-haspopup="dialog" onClick={() => open({ kind: 'cat', id: null }, 'add-cat')}>
          <Icon name="plus" size={16} stroke={2.6} />
          Categorie toevoegen
        </button>
        <p className="ct-foot anim-in" style={delay(120)}>
          Overschrijvingen tussen je eigen rekeningen herkent Saldo zelf: ze tellen niet mee als uitgave of inkomst. Wat naar een spaarrekening gaat, telt als gespaard.
        </p>
      </>
    );
  };

  // ---------- Regels ----------

  const move = async (r: Rule, dir: -1 | 1) => {
    if (!ruleList || moving.current) return;
    if (!online) return toast('Je bent offline');
    const ids = ruleList.filter((x) => x.permission === 'edit').map((x) => x.id);
    const i = ids.indexOf(r.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    moving.current = true;
    try {
      const list = await api.reorderRules(ids);
      rules.setData(list);
      const at = list.findIndex((x) => x.id === r.id);
      const editable = list.filter((x) => x.permission === 'edit');
      const k = editable.findIndex((x) => x.id === r.id);
      // At the edge the pressed button is disabled: focus the other one, as the mockup does.
      const edge = k === 0 || k === editable.length - 1;
      focusKey.current = (edge ? (dir < 0 ? 'down-' : 'up-') : dir < 0 ? 'up-' : 'down-') + r.id;
      announce('Regel ‘' + ruleLabel(r) + '’ staat nu op positie ' + (at + 1) + ' van ' + list.length + '.');
    } catch (e) {
      toast(errorMessage(e));
      if (e instanceof ApiError && e.status === 400) rules.reload();
    } finally {
      moving.current = false;
    }
  };

  const ruleTab = () => {
    const list = ruleList!;
    const intro = <Note icon="info" title="Een handmatige keuze wint altijd, dan de regel met de hoogste prioriteit, dan een suggestie." text="De volgorde telt alleen tussen regels die op dezelfde rekening gelden." />;
    const addBtn = (
      <button type="button" className="btn btn--dashed btn--block only-phone ct-add-phone anim-in" style={delay(110)} data-key="add-rule" aria-haspopup="dialog" onClick={() => open({ kind: 'rule', id: null }, 'add-rule')}>
        <Icon name="plus" size={16} stroke={2.6} />
        Regel toevoegen
      </button>
    );
    if (!list.length) {
      return (
        <>
          {intro}
          <EmptyCard title="Nog geen regels" text="Een regel geeft transacties vanzelf een categorie, bijvoorbeeld alles van Colruyt naar Boodschappen." />
          {addBtn}
        </>
      );
    }
    const selId = desktop && shown.kind === 'rule' ? shown.id : null;
    const editable = list.filter((x) => x.permission === 'edit');
    return (
      <>
        {intro}
        {!online && <OfflineLine />}
        <section className="ct-group anim-in" style={delay(60)} aria-labelledby="ct-g-rules">
          <div className="ct-group-head">
            <h2 className="label" id="ct-g-rules">
              Op volgorde van prioriteit
            </h2>
            <span className="ct-group-right">{plural(list.length, 'regel', 'regels')}</span>
          </div>
          <ol className="ct-rules">
            {list.map((r, i) => {
              const cs = ruleConditions(r);
              const ro = r.permission !== 'edit';
              const k = editable.indexOf(r);
              const mv = (dir: -1 | 1) => (
                <button
                  type="button"
                  className="ct-move-btn"
                  data-key={(dir < 0 ? 'up-' : 'down-') + r.id}
                  aria-label={'Regel ' + (i + 1) + (dir < 0 ? ' hoger' : ' lager') + ' zetten'}
                  disabled={!online || (dir < 0 ? k === 0 : k === editable.length - 1)}
                  onClick={() => void move(r, dir)}
                >
                  <Icon name={dir < 0 ? 'arrowUp' : 'arrowDown'} size={16} stroke={2.4} />
                </button>
              );
              return (
                <li key={r.id} className={'ct-rule' + (ro ? ' ct-rule--ro' : '')}>
                  <span className="ct-prio" aria-hidden="true">
                    {i + 1}
                  </span>
                  <button
                    type="button"
                    className="ct-rule-main"
                    data-key={'rule-' + r.id}
                    aria-pressed={desktop ? selId === r.id : undefined}
                    aria-haspopup={desktop ? undefined : 'dialog'}
                    onClick={() => {
                      if (desktop && shown.kind === 'rule' && shown.id === r.id) return;
                      open({ kind: 'rule', id: r.id }, 'rule-' + r.id);
                    }}
                  >
                    <span className="visually-hidden">Prioriteit {i + 1}: </span>
                    <span className="ct-rule-cond">{cs[0] ?? ''}</span>
                    {cs.slice(1).map((x) => (
                      <span className="ct-rule-more" key={x}>
                        <span className="visually-hidden">, </span>en {lower(x)}
                      </span>
                    ))}
                    <span className="ct-rule-meta">
                      <span className="ct-to" aria-hidden="true">
                        →
                      </span>
                      <span className="visually-hidden">naar </span>
                      <CatChip c={byId.get(r.categoryId)} byId={byId} />
                      <span className="visually-hidden">, geldt voor </span>
                      <OwnerChip accountId={r.accountId} accounts={accs} />
                      {ro && <ReadOnlyChip />}
                    </span>
                  </button>
                  {!ro && (
                    <span className="ct-move">
                      {mv(-1)}
                      {mv(1)}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
        {addBtn}
      </>
    );
  };

  // ---------- Suggesties ----------

  const decide = async (s: Suggestion, confirm: boolean) => {
    if (busySugg.current) return;
    busySugg.current = true;
    setBusyKey(s.counterpartyKey);
    const list = sugg.data ?? [];
    const i = list.indexOf(s);
    try {
      if (confirm) {
        const { updated, rule } = await api.confirmSuggestion(s.counterpartyKey, s.categoryId);
        const cat = byId.get(s.categoryId)?.name ?? 'de categorie';
        const n = plural(updated, 'transactie', 'transacties');
        const head = !rule
          ? null
          : rule.conflict
            ? 'Er is al een regel voor ' + s.counterparty + ' met een andere categorie. Die blijft staan'
            : (rule.created ? 'Regel gemaakt' : 'Regel bestond al') + ': ' + s.counterparty + ' wordt ' + cat;
        toast(head === null ? n + ' naar ' + cat : head + (updated ? ' · ' + n + ' gecategoriseerd' : ''), rule ? { label: 'Regel openen', to: '/categorieen?tab=regels&regel=' + rule.id } : undefined);
        refreshShell();
        cats.reload();
        rules.reload();
      } else {
        await api.dismissSuggestion(s.counterpartyKey, s.categoryId);
        toast('Genegeerd');
      }
      const rest = list.filter((x) => x !== s);
      sugg.setData(rest);
      const next = rest[Math.min(i, rest.length - 1)];
      focusKey.current = next ? 'confirm-' + next.counterpartyKey : 'tab-suggesties';
    } catch (e) {
      toast(errorMessage(e));
      // Gone meanwhile (404): load the list again.
      if (e instanceof ApiError && e.status === 404) sugg.reload();
    } finally {
      busySugg.current = false;
      setBusyKey(null);
    }
  };

  const suggTab = () => {
    const list = sugg.data!;
    const intro = (
      <Note
        icon="spark"
        title="Saldo leert van je keuzes"
        text="Een tegenpartij krijgt de categorie die je er het vaakst voor koos. Een suggestie met lage zekerheid wordt nooit toegepast zonder jouw bevestiging. Bevestigen categoriseert de transacties die nu wachten en maakt een regel voor nieuwe transacties op je persoonlijke rekeningen. Bij hoge zekerheid kan je met ‘Maak regel’ de regel eerst aanpassen."
      />
    );
    if (!list.length) {
      return (
        <>
          {intro}
          <EmptyCard title="Geen suggesties" text="Saldo stelt een categorie voor zodra het een tegenpartij vaak genoeg ziet." />
        </>
      );
    }
    const fromKey = shown.kind === 'rule' ? shown.from?.counterpartyKey : undefined;
    return (
      <>
        {intro}
        {!online && <OfflineLine />}
        <div className="ct-bf-bar">
          <button type="button" className="btn btn--secondary" disabled={!online} aria-haspopup="dialog" onClick={() => setBackfill(true)}>
            Geschiedenis toepassen
          </button>
          <span>Categoriseer in één keer de transacties zonder categorie, na een voorbeeld.</span>
        </div>
        <div className="ct-suggs">
          {list.map((s, i) => {
            const high = s.level === 'high';
            const nameId = 'ct-s-' + i;
            const off = !online || busyKey !== null;
            return (
              <article key={s.counterpartyKey} className={'ct-sugg anim-in' + (desktop && fromKey === s.counterpartyKey ? ' is-on' : '')} style={delay(60 + i * 30)} aria-labelledby={nameId}>
                <div className="ct-sugg-head">
                  <span className="ct-sugg-av" aria-hidden="true">
                    {s.counterparty.charAt(0).toUpperCase()}
                  </span>
                  <span className="ct-sugg-text">
                    <span className="ct-sugg-name" id={nameId}>
                      {s.counterparty}
                    </span>
                    <span className="ct-sugg-sub">
                      {s.seen} keer gezien · {plural(s.open, 'transactie wacht', 'transacties wachten')}
                    </span>
                  </span>
                </div>
                <div className="ct-sugg-to">
                  <span className="ct-sugg-label">Voorstel</span>
                  <CatChip c={byId.get(s.categoryId)} byId={byId} />
                </div>
                <div className="ct-sugg-conf">
                  <span className="ct-sugg-label">Zekerheid</span>
                  <span className="ct-meter" aria-hidden="true">
                    <span style={{ width: s.confidence + '%', background: high ? 'var(--green)' : 'var(--dashed)' }} />
                  </span>
                  <span className={'ct-conf ct-conf--' + (high ? 'hoog' : 'laag')}>
                    {high ? 'Hoge zekerheid' : 'Lage zekerheid'} · {s.confidence}&nbsp;%
                  </span>
                </div>
                {!high && (
                  <p className="ct-sugg-low">
                    <Icon name="info" size={14} stroke={2.2} />
                    <span>Alleen bevestigen: Saldo past dit niet toe zonder jouw bevestiging.</span>
                  </p>
                )}
                <div className="ct-sugg-actions">
                  {high && (
                    <button
                      type="button"
                      className="btn btn--primary"
                      data-key={'as-rule-' + s.counterpartyKey}
                      aria-haspopup={desktop ? undefined : 'dialog'}
                      onClick={() => open({ kind: 'rule', id: null, from: s }, 'as-rule-' + s.counterpartyKey, true)}
                    >
                      Maak regel
                    </button>
                  )}
                  <button type="button" className={'btn ' + (high ? 'btn--secondary' : 'btn--primary')} data-key={'confirm-' + s.counterpartyKey} disabled={off} aria-busy={busyKey === s.counterpartyKey || undefined} onClick={() => void decide(s, true)}>
                    Bevestigen
                  </button>
                  <button type="button" className="btn btn--ghost" disabled={off} onClick={() => void decide(s, false)}>
                    Negeren
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </>
    );
  };

  // ---------- Editors ----------

  const edLabel = (e: Ed): string => {
    if (e.kind === 'info') return 'Zo kiest Saldo een categorie';
    if (e.kind === 'cat') return e.id === null ? 'Nieuwe categorie' : 'Categorie bewerken';
    if (e.kind === 'del') return 'Categorie verwijderen';
    const r = e.id === null ? undefined : ruleList?.find((x) => x.id === e.id);
    if (r && r.permission !== 'edit') return 'Regel bekijken';
    return r ? 'Regel bewerken' : 'Nieuwe regel';
  };

  const editor = (e: Ed, mode: 'p' | 'd'): ReactNode => {
    if (!tree || !ruleList) return null;
    const onClose = () => close();
    if (e.kind === 'cat') {
      const c = e.id === null ? null : byId.get(e.id);
      if (c === undefined) return <Info />;
      return (
        <CatEditor
          key={'cat-' + e.id + '-' + e.parentId}
          mode={mode}
          cat={c}
          parentId={e.parentId}
          tree={tree}
          counts={hasTx}
          onClose={onClose}
          onNewSub={(parentId) => open({ kind: 'cat', id: null, parentId }, null, true)}
          onRemove={() => c && open({ kind: 'del', id: c.id }, null, true)}
          onSaved={(saved) => {
            setSelCat(saved.id);
            cats.reload();
            done({ kind: 'cat', id: saved.id }, 'cat-' + saved.id);
          }}
        />
      );
    }
    if (e.kind === 'del') {
      const c = byId.get(e.id);
      if (!c) return <Info />;
      return (
        <DelEditor
          key={'del-' + c.id}
          mode={mode}
          cat={c}
          tree={tree}
          rules={ruleList}
          counts={hasTx}
          onClose={onClose}
          onCancel={() => open({ kind: 'cat', id: c.id }, null, true)}
          onDone={(target) => {
            const next = target?.id ?? c.parentId ?? tree.find((x) => x.parentId === null && x.id !== c.id)?.id ?? null;
            setSelCat(next);
            cats.reload();
            rules.reload();
            sugg.reload();
            refreshShell();
            done(next === null ? { kind: 'info' } : { kind: 'cat', id: next }, next === null ? 'tab-categorieen' : 'cat-' + next);
          }}
        />
      );
    }
    if (e.kind === 'rule') {
      const r = e.id === null ? null : ruleList.find((x) => x.id === e.id);
      if (r === undefined) return <Info />;
      if (r && r.permission !== 'edit') return <RuleView mode={mode} rule={r} rules={ruleList} tree={tree} accounts={accs} onClose={onClose} />;
      return (
        <RuleEditor
          key={'rule-' + e.id + '-' + (e.from?.counterpartyKey ?? '')}
          mode={mode}
          rule={r}
          from={e.from}
          rules={ruleList}
          tree={tree}
          accounts={accs}
          onClose={onClose}
          onStale={rules.reload}
          onSaved={(saved, list, applied) => {
            setSelRule(saved.id);
            if (list) rules.setData(list);
            else rules.reload();
            if (applied) {
              cats.reload();
              sugg.reload();
              refreshShell();
            }
            if (e.from) done({ kind: 'info' }, 'as-rule-' + e.from.counterpartyKey);
            else done({ kind: 'rule', id: saved.id }, 'rule-' + saved.id);
          }}
          onDeleted={(id) => {
            const i = ruleList.findIndex((x) => x.id === id);
            const rest = ruleList.filter((x) => x.id !== id);
            rules.setData(rest);
            const next = rest[Math.min(i, rest.length - 1)];
            setSelRule(next?.id ?? null);
            done(next ? { kind: 'rule', id: next.id } : { kind: 'info' }, next ? 'rule-' + next.id : 'tab-regels');
          }}
        />
      );
    }
    return <Info />;
  };

  // ---------- Page ----------

  // The tree, the rules (rule notes, chips) and the accounts (owners) are needed on every tab.
  const need: { error: string | null; data: unknown }[] = [cats, rules, accounts, ...(tab === 'suggesties' ? [sugg] : [])];
  const failed = need.find((x) => x.error && x.data === undefined);
  const ready = need.every((x) => x.data !== undefined);

  let body: ReactNode;
  if (failed) {
    body = (
      <ErrorState
        message={failed.error!}
        onRetry={() => {
          for (const x of [cats, rules, sugg, accounts]) if (x.error) x.reload();
        }}
      />
    );
  } else if (!ready) body = <Skeleton />;
  else {
    const content = tab === 'regels' ? ruleTab() : tab === 'suggesties' ? suggTab() : catTab();
    body = (
      <div className="ct-layout" role="tabpanel" id="ct-tabpanel" aria-labelledby={'ct-tab-' + tab}>
        <div className="ct-col">{content}</div>
        {desktop && (
          <div className="ct-aside">
            <section className="ct-panel anim-in" style={delay(60)} id="ct-panel" aria-label={edLabel(shown)}>
              <div className="anim-fade" key={JSON.stringify(shown)}>
                {editor(shown, 'd')}
              </div>
            </section>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page ct-page" ref={page}>
      {header}
      {tabs}
      {body}
      {!desktop && sheet && ed && ready && (
        <Sheet onClose={() => close()} label={edLabel(ed)} className="ct-sheet" backdropClassName="ct-backdrop">
          {editor(ed, 'p')}
        </Sheet>
      )}
      {backfill && (
        <BackfillSheet
          onClose={() => setBackfill(false)}
          onDone={(r) => {
            setBackfill(false);
            toast(plural(r.categorised, 'transactie', 'transacties') + ' gecategoriseerd' + (r.stale ? ' · ' + plural(r.stale, 'groep was', 'groepen waren') + ' niet meer geldig' : ''));
            refreshShell();
            cats.reload();
            sugg.reload();
          }}
        />
      )}
      <p className="visually-hidden" aria-live="polite">
        {live}
      </p>
    </div>
  );
}
