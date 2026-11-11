// Importeren, step 3 (phase 0.5-3): where every category pair of the file goes in Saldo's own category tree.
// Design: finance-mockup/js/screens/importeren.js (Stap 3), with the shared Select and IconPicker.
// The saved mapping and a suggestion by name are pre-selected and labelled, so they are seen before anything is sent.
import { useId, useMemo, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { IconPicker } from '../components/IconPicker';
import { Select, type SelectOption } from '../components/Select';
import { delay, ErrorState, SkelList } from '../components/ui';
import { api } from '../lib/api';
import { catColours, groupTree } from '../lib/categories';
import { categoryIcon } from '../lib/categoryIcons';
import { eur } from '../lib/format';
import { defaultPick, inGroup, mergesOf, pairKey, parentDefault, pickOf, type CategoryPicks, type FileCategory, type Pick, type PickOrigin } from '../lib/imports';
import type { TreeCategory } from '../lib/types';
import { useAsync } from '../lib/useAsync';

const num = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const plural = (n: number, one: string, many: string) => num(n) + ' ' + (n === 1 ? one : many);

/** One row of the table: a pair of the file, or (per main category) all the pairs under one main category. */
interface Unit {
  key: string;
  /** The pair of a single row; the main category's pairs for a group. */
  pairs: FileCategory[];
  top: string;
  /** The label the select announces. */
  label: string;
  rows: number;
  total: number;
  /** The name a new category starts with. */
  name: string;
  pick: Pick;
  /** Where the pre-selected target came from, 'own' once the user chose. */
  origin: PickOrigin | 'own';
}

function unitsOf(all: FileCategory[], s: CategoryPicks): Unit[] {
  const out: Unit[] = [];
  const seen = new Set<string>();
  for (const c of all) {
    const group = s.parentMode && inGroup(c);
    if (group && seen.has(c.category)) continue;
    const pairs = group ? all.filter((x) => inGroup(x) && x.category === c.category) : [c];
    let origin: Unit['origin'];
    if (group) {
      origin = s.parentPicks[c.category] ? 'own' : parentDefault(c.category, s, all).value === 'none' ? 'none' : pairs.every((x) => defaultPick(x).origin === 'saved') ? 'saved' : 'suggest';
    } else {
      origin = s.picks[pairKey(c)] ? 'own' : defaultPick(c).origin;
    }
    seen.add(c.category);
    out.push({
      key: group ? 'p:' + c.category : pairKey(c),
      pairs,
      top: group ? c.category : '',
      label: group ? c.category : c.category && c.subcategory ? c.category + ' › ' + c.subcategory : c.subcategory || c.category,
      rows: pairs.reduce((n, x) => n + x.rows, 0),
      total: pairs.reduce((n, x) => n + x.total, 0),
      name: group ? c.category : c.subcategory || c.category,
      pick: pickOf(c, s, all),
      origin,
    });
  }
  return out;
}

function Badge({ origin }: { origin: Unit['origin'] }) {
  if (origin === 'saved')
    return (
      <span className="im-badge im-badge--saved" title="Uit je opgeslagen koppeling voor deze bron">
        <Icon name="check" size={12} stroke={3} />
        Opgeslagen
      </span>
    );
  if (origin === 'suggest')
    return (
      <span className="im-badge im-badge--ok" title="Voorstel op basis van de naam">
        Voorstel
      </span>
    );
  return null;
}

/** The icon of a category in its main category's pastel, drawn before its name in the list. */
function Dot({ c }: { c: TreeCategory }) {
  const { bg, fg } = catColours(c.colour);
  return (
    <span className="im-opt-ico" style={{ background: bg, color: fg }} aria-hidden="true">
      <Icon name={categoryIcon(c.icon)} size={12} stroke={2.4} />
    </span>
  );
}

interface Props {
  cats: FileCategory[];
  state: CategoryPicks;
  onChange: (next: CategoryPicks) => void;
  /** "Bilance" for the intro: what the mapping is saved for. */
  source: string;
}

/** The table, once the shared category tree of the targets is read. */
export function CategoryStep(props: Props) {
  const tree = useAsync((signal) => api.categories(signal), []);
  if (tree.data) return <CategoryTable {...props} tree={tree.data} />;
  if (tree.error) return <ErrorState message={tree.error} onRetry={tree.reload} />;
  return <SkelList rows={2} label="Categorieën van Saldo laden" />;
}

function CategoryTable({ cats, tree, state, onChange, source }: Props & { tree: TreeCategory[] }) {
  const uid = useId();
  const byId = useMemo(() => new Map(tree.map((c) => [String(c.id), c])), [tree]);
  const groups = useMemo(() => groupTree(tree), [tree]);
  const targets = useMemo<SelectOption[]>(
    () =>
      [...groups.expense, ...groups.income].flatMap((g) =>
        [g.top, ...g.subs].map((c) => ({
          value: String(c.id),
          label: c === g.top ? c.name : g.top.name + ' › ' + c.name,
          group: g.top.name,
          lead: <Dot c={c} />,
        })),
      ),
    [groups],
  );
  const parents = useMemo<SelectOption[]>(
    () => [{ value: '', label: 'Nieuwe hoofdcategorie' }, ...[...groups.expense, ...groups.income].map((g) => ({ value: String(g.top.id), label: g.top.name }))],
    [groups],
  );

  const units = unitsOf(cats, state);
  const merges = mergesOf(cats, state);
  const hasGroups = cats.some(inGroup);
  const labelOf = (v: string) => {
    const c = byId.get(v);
    const top = c?.parentId == null ? undefined : tree.find((t) => t.id === c.parentId);
    return c ? (top ? top.name + ' › ' + c.name : c.name) : '';
  };

  const set = (u: Unit, pick: Pick) =>
    onChange(u.top ? { ...state, parentPicks: { ...state.parentPicks, [u.top]: pick } } : { ...state, picks: { ...state.picks, [u.key]: pick } });
  const choose = (u: Unit, v: string) => set(u, v === 'new' ? { ...u.pick, value: 'new', name: u.pick.name || u.name } : { ...u.pick, value: v });

  // How the units stand: the chips above the table.
  const count = { saved: 0, suggest: 0, new: 0, none: 0, own: 0 };
  for (const u of units) {
    if (u.origin === 'own') count.own++;
    else if (u.pick.value === 'new') count.new++;
    else if (u.origin === 'saved') count.saved++;
    else if (u.origin === 'suggest') count.suggest++;
    else count.none++;
  }
  const rowsWith = units.filter((u) => u.pick.value !== 'none').reduce((n, u) => n + u.rows, 0);
  const rowsAll = cats.reduce((n, c) => n + c.rows, 0);
  const fresh = units.filter((u) => u.pick.value === 'new');
  const chips: ReactNode[] = [
    count.saved > 0 && (
      <span key="s" className="im-badge im-badge--saved">
        <Icon name="check" size={12} stroke={3} />
        {count.saved} opgeslagen
      </span>
    ),
    count.suggest > 0 && (
      <span key="v" className="im-badge im-badge--ok">
        {plural(count.suggest, 'voorstel', 'voorstellen')}
      </span>
    ),
    count.new > 0 && (
      <span key="n" className="im-badge im-badge--new">
        {count.new} nieuw
      </span>
    ),
    count.none > 0 && (
      <span key="x" className="im-badge im-badge--none">
        {count.none} niet categoriseren
      </span>
    ),
    count.own > 0 && (
      <span key="o" className="im-badge im-badge--none">
        {count.own} zelf gekozen
      </span>
    ),
  ];

  return (
    <>
      <div className="im-catnote anim-in" style={delay(60)}>
        <Icon name="info" size={18} stroke={2.2} />
        <div>
          <strong>Deze koppeling wordt bewaard voor {source}. Volgende keer hoef je niets te koppelen.</strong>
          <p>Wat je hier kiest, wordt pas bewaard als je importeert.</p>
        </div>
      </div>
      <div className="im-cattools anim-in" style={delay(75)}>
        <div className="im-sum-chips">{chips}</div>
        <div className="im-toggle">
          <span className="im-toggle-text">
            <span className="im-toggle-name" id={uid + '-pm'}>
              Per hoofdcategorie koppelen
            </span>
            <span className="im-toggle-sub">Alle subcategorieën krijgen hetzelfde doel, bv. alles onder Wonen</span>
          </span>
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={state.parentMode}
            aria-labelledby={uid + '-pm'}
            disabled={!hasGroups}
            onClick={() => onChange({ ...state, parentMode: !state.parentMode })}
          />
        </div>
      </div>
      <section className="im-card im-card--table anim-in" style={delay(90)} aria-label="Categorieën koppelen">
        <div className="im-th im-catrow only-desktop" aria-hidden="true">
          <span>Categorie in {source}</span>
          <span>Transacties</span>
          <span>Totaal</span>
          <span />
          <span>Categorie in Saldo</span>
        </div>
        {units.map((u, i) => {
          const none = u.pairs.length === 1 && !u.pairs[0].category && !u.pairs[0].subcategory;
          const c = u.pairs[0];
          const mates = u.pick.value !== 'none' && u.pick.value !== 'new' ? (merges.get(u.pick.value) ?? []).filter((x) => !u.pairs.includes(x)) : [];
          const shownLabel = (x: FileCategory) => (x.category && x.subcategory ? x.category + ' › ' + x.subcategory : x.subcategory || x.category);
          return (
            <div className="im-tr im-catrow" key={u.key}>
              <div className="im-catrow-src">
                {none ? (
                  <span className="im-path">
                    <span className="im-path-leaf muted">Zonder categorie</span>
                  </span>
                ) : u.top ? (
                  <>
                    <span className="im-path-leaf">{u.top}</span>
                    <span className="im-path-kids">
                      {plural(u.pairs.length, 'subcategorie', 'subcategorieën')}: {u.pairs.map((x) => x.subcategory).join(', ')}
                    </span>
                  </>
                ) : (
                  <span className="im-path">
                    {c.category && c.subcategory && <span className="im-path-parent">{c.category} &gt; </span>}
                    <span className="im-path-leaf">{c.subcategory || c.category}</span>
                  </span>
                )}
              </div>
              <div className="im-catrow-n">
                <span className="mono">{num(u.rows)}</span>
                <span className="only-phone"> transacties</span>
              </div>
              <div className={'im-catrow-sum mono' + (u.total > 0 ? ' pos' : '')}>{eur(u.total, u.total > 0)}</div>
              <span className="im-arrow" aria-hidden="true">
                <Icon name="chevron" size={16} stroke={2} />
              </span>
              <div className="im-catrow-tgt">
                {none ? (
                  <>
                    <span className="im-fixed">Niet categoriseren</span>
                    <span className="im-hint">Je regels en suggesties beslissen later.</span>
                  </>
                ) : (
                  <>
                    <div className="im-catrow-pick">
                      <Select
                        label={'Categorie in Saldo voor ' + u.label}
                        value={u.pick.value}
                        onChange={(v) => choose(u, v)}
                        options={[
                          { value: 'none', label: 'Niet categoriseren' },
                          { value: 'new', label: u.pick.value === 'new' ? 'Nieuwe categorie' + (u.pick.name.trim() ? ' ‘' + u.pick.name.trim() + '’' : '') : 'Nieuwe categorie ‘' + u.name + '’' },
                          ...targets,
                        ]}
                      />
                      <Badge origin={u.origin} />
                    </div>
                    {mates.length > 0 && (
                      <span className="im-merge">
                        <Icon name="merge" size={14} stroke={2.2} />
                        Samen met {mates.map(shownLabel).join(', ')}
                      </span>
                    )}
                    {u.pick.value === 'new' && (
                      <div className="im-newed">
                        <div className="field">
                          <label className="field-label" htmlFor={uid + '-n' + i}>
                            Naam
                          </label>
                          <input
                            id={uid + '-n' + i}
                            className="input"
                            value={u.pick.name}
                            maxLength={60}
                            onChange={(e) => set(u, { ...u.pick, name: e.target.value })}
                          />
                        </div>
                        <div className="field">
                          <span className="field-label" id={uid + '-p' + i}>
                            Komt onder
                          </span>
                          <Select
                            label={'Plaats van de nieuwe categorie voor ' + u.label}
                            value={u.pick.parent}
                            options={parents}
                            onChange={(v) => set(u, { ...u.pick, parent: v })}
                          />
                        </div>
                        <div className="field">
                          <span className="field-label" id={uid + '-i' + i}>
                            Icoon
                          </span>
                          <IconPicker
                            value={u.pick.icon || null}
                            colour={byId.get(u.pick.parent)?.colour ?? 'c6'}
                            labelledBy={uid + '-i' + i}
                            onChange={(icon) => set(u, { ...u.pick, icon })}
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </section>
      <p className="im-help anim-in" style={delay(105)}>
        <strong>{plural(rowsWith, 'transactie krijgt', 'transacties krijgen')} een categorie</strong>
        {rowsAll - rowsWith > 0 && ', ' + num(rowsAll - rowsWith) + ' blijven zonder (je regels en suggesties beslissen later).'}
      </p>
      <div className="im-grid2 anim-in" style={delay(120)}>
        <section className="im-card" aria-labelledby={uid + '-mh'}>
          <h3 className="im-card-title" id={uid + '-mh'}>
            <Icon name="merge" size={16} stroke={2.2} />
            Samengevoegd
          </h3>
          {merges.size ? (
            <>
              <p className="im-help">Deze categorieën uit {source} komen samen in één categorie van Saldo.</p>
              <ul className="im-merges">
                {[...merges].map(([v, list]) => {
                  const c = byId.get(v)!;
                  const { bg, fg } = catColours(c.colour);
                  return (
                    <li key={v}>
                      <span className="im-cat" style={{ background: bg, color: fg }}>
                        {labelOf(v)}
                      </span>
                      <span className="im-merges-from">
                        {list.map((x) => (x.category && x.subcategory ? x.category + ' › ' + x.subcategory : x.subcategory || x.category)).join(' + ')}
                      </span>
                      <span className="im-merges-n">{plural(list.length, 'bron', 'bronnen')} in deze categorie</span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="im-help">Kies dezelfde categorie bij meerdere rijen om ze samen te voegen.</p>
          )}
        </section>
        <section className="im-card" aria-labelledby={uid + '-nh'}>
          <h3 className="im-card-title" id={uid + '-nh'}>
            <Icon name="plus" size={16} stroke={2.4} />
            Nieuwe categorieën
          </h3>
          {fresh.length ? (
            <>
              <div className="im-newcats">
                {[...new Set(fresh.map((u) => u.pick.parent + '|' + u.pick.name.trim()))].map((k) => {
                  const [parent, name] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
                  return (
                    <span className="im-cat im-cat--new" key={k}>
                      <Icon name="plus" size={12} stroke={2.6} />
                      {(parent ? labelOf(parent) + ' › ' : '') + (name || '…')}
                    </span>
                  );
                })}
              </div>
              <p className="im-help">Saldo maakt ze aan bij Categorieën en regels, als je importeert. Daar kan je ze later verplaatsen of hernoemen.</p>
            </>
          ) : (
            <p className="im-help">Geen. Alles komt in een bestaande categorie of blijft zonder.</p>
          )}
        </section>
      </div>
    </>
  );
}
