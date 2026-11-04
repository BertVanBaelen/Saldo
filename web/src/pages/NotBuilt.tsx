// Screens that are not built yet: the title, what the screen will do and the version it arrives in.
// No figures and no fake data (plan/README.md for the versions).
import { Link } from 'react-router-dom';
import { navItem, type ScreenId } from '../app/nav';
import { Icon, type IconName } from '../components/Icon';
import { delay, useTitle } from '../components/ui';

interface Soon {
  version: string;
  text: string;
}

export const SOON: Partial<Record<ScreenId, Soon>> = {
  overzicht: { version: '0.7', text: 'Je inkomsten, uitgaven en wat je spaarde, per maand, per rekening en per categorie.' },
  planning: { version: '0.8', text: 'Per rekening zien hoe de komende maanden aflopen tegen de eigen buffer, met terugkerende en eenmalige posten en wat je nog vrij kan besteden.' },
  categorieen: { version: '0.4', text: 'Je categorieën en regels beheren en suggesties bevestigen, zodat transacties vanzelf een categorie krijgen.' },
  importeren: { version: '0.3 en 0.5', text: 'Transacties uit een CSV-bestand importeren: eerst de export van je bank (0.3), daarna je volledige geschiedenis uit Bilance (0.5).' },
  meldingen: { version: '0.9', text: 'Pushmeldingen en e-mails per soort aan- of uitzetten, met een vooruitblik en stille uren.' },
};

export function NotBuilt({ id }: { id: ScreenId | null }) {
  const item = id ? navItem(id) : undefined;
  const soon = id ? SOON[id] : undefined;
  const title = item?.label ?? 'Niet gevonden';
  useTitle(title);
  const sub = item?.tabParent === 'meer';
  const icon: IconName = item?.icon ?? 'info';

  return (
    <div className="page">
      <div className="sub-head anim-fade">
        {sub && (
          <Link className="page-back only-phone" to="/meer" aria-label="Terug naar Meer">
            <Icon name="back" size={22} stroke={2.4} />
          </Link>
        )}
        <h1>{title}</h1>
      </div>
      {soon ? (
        <section className="state-card anim-in" style={delay(40)} aria-labelledby="soon-title">
          <span className="state-icon state-icon--soon" aria-hidden="true">
            <Icon name={icon} size={26} stroke={2.2} />
          </span>
          <h2 id="soon-title">Nog niet gebouwd</h2>
          <p>{soon.text}</p>
          <span className="state-tag">Komt in versie {soon.version}</span>
        </section>
      ) : (
        <section className="state-card anim-in" style={delay(40)} aria-labelledby="soon-title">
          <span className="state-icon state-icon--soon" aria-hidden="true">
            <Icon name={icon} size={26} stroke={2.2} />
          </span>
          <h2 id="soon-title">Deze pagina bestaat niet</h2>
          <p>Kijk het adres na, of ga terug naar Start.</p>
          <Link className="btn btn--secondary" to="/">
            Naar Start
          </Link>
        </section>
      )}
    </div>
  );
}
