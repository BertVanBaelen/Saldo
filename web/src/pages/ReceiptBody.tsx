// The paper of the overview receipt (plan 0.9-3d step 4, analysis/screens/overzichtbon.md): the content that <ReceiptPrinter> prints.
// Real text from the model's integer cents (lib/receipt.ts formats it: `1.234,56`, U+2212, no float and no toFixed), one ink colour,
// no verdict word. Every visual line is its own <p> of 15 px (the printer's simulation counts on it); a name is cut with an ellipsis
// and keeps its full text in `title`; the notes may wrap. The CSS (`.bon-*`) is in OverzichtBon.css.
import { Fragment } from 'react';
import { budgetText, emptyText, footerText, plain, previousText, trendText } from '../lib/receipt';
import type { Receipt, ReceiptRow } from '../lib/types';
import './OverzichtBon.css';

/** One row: the name left, the amount and the trend right (the same columns on every row, so the amounts line up). `depth`: 2 characters of indent per level. */
function Line({ name, amount, trend = '', depth = 0, strong = false }: { name: string; amount: string; trend?: string; depth?: number; strong?: boolean }) {
  return (
    <p className={'bon-line' + (strong ? ' bon-strong' : '')} style={depth ? { paddingLeft: depth * 2 + 'ch' } : undefined}>
      <span className="bon-name" title={name}>
        {name}
      </span>
      <span className="bon-vals">
        <span className="bon-amt">{amount}</span>
        <span className="bon-trend">{trend}</span>
      </span>
    </p>
  );
}

/** A line of text under a row ("budget 550,00 · 117 %"). */
function Sub({ text, depth }: { text: string; depth: number }) {
  return (
    <p className="bon-line" style={{ paddingLeft: depth * 2 + 'ch' }}>
      <span className="bon-name" title={text}>
        {text}
      </span>
    </p>
  );
}

const Gap = () => <p className="bon-gap" aria-hidden="true" />;
const Rule = () => <p className="bon-rule" aria-hidden="true" />;

/** The rows of a section: a row, its budget line (months), then its subcategories one level deeper. A trend and a budget only come on expense groups. */
function Rows({ rows, depth }: { rows: ReceiptRow[]; depth: number }) {
  return (
    <>
      {rows.map((r) => (
        <Fragment key={r.key}>
          <Line name={r.name} amount={plain(r.amount)} trend={r.trend ? trendText(r.trend) : ''} depth={depth} />
          {r.budget && <Sub text={budgetText(r.budget)} depth={depth + 1} />}
          {r.children && r.children.length > 0 && <Rows rows={r.children} depth={depth + 1} />}
        </Fragment>
      ))}
    </>
  );
}

/** A decorative barcode: bars from the period and the scope, so every receipt has its own. Not content: hidden from screen readers. */
function Barcode({ seed }: { seed: string }) {
  let n = 0;
  for (const c of seed) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  const bars: { x: number; w: number }[] = [];
  for (let x = 0; x < 200; ) {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    const w = 1 + ((n >>> 24) % 3);
    bars.push({ x, w });
    x += w + 1 + ((n >>> 16) % 2);
  }
  return (
    <div className="bon-barcode" aria-hidden="true">
      <svg viewBox="0 0 200 30" preserveAspectRatio="none" width="100%" height="30" focusable="false">
        {bars.map((b) => (
          <rect key={b.x} x={b.x} y={0} width={b.w} height={30} fill="currentColor" />
        ))}
      </svg>
    </div>
  );
}

export function ReceiptBody({ model }: { model: Receipt }) {
  const kind = model.period;
  const { income, expenses, saved, result } = model;
  return (
    <>
      <p className="bon-text bon-center bon-strong">SALDO</p>
      <p className="bon-text bon-center">{model.label}</p>
      <p className="bon-text bon-center">{model.scopeLabel}</p>
      <Rule />
      <p className="bon-text bon-center">bedragen in €</p>
      <Gap />
      {model.empty ? (
        <p className="bon-text bon-center">{emptyText(kind)}</p>
      ) : (
        <>
          <Line name="INKOMEN" amount={plain(income.total)} strong />
          <Rows rows={income.rows} depth={1} />
          <Gap />
          <Line name="UITGAVEN" amount={plain(expenses.total)} trend={expenses.trend ? trendText(expenses.trend) : ''} strong />
          <Rows rows={expenses.groups} depth={1} />
          <Gap />
          <Line name="GESPAARD" amount={plain(saved.total)} strong />
          <Rows rows={saved.rows} depth={1} />
          <Rule />
          <Line name="OVER" amount={plain(result.total)} strong />
          {result.prev !== undefined && <Line name={previousText(kind)} amount={plain(result.prev)} depth={1} />}
        </>
      )}
      {model.notes.length > 0 && (
        <>
          <Gap />
          {model.notes.map((note) => (
            <p className="bon-text" key={note}>
              {note}
            </p>
          ))}
        </>
      )}
      <Gap />
      <Barcode seed={model.period + model.from + model.scope} />
      <Gap />
      <p className="bon-text bon-center">{footerText(kind)}</p>
    </>
  );
}
