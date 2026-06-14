/**
 * FeatArtistLinks.tsx — Affiche les artistes "feat." sous forme de liens cliquables
 * quand l'artiste existe dans la base de données.
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

export interface FeatArtistLinksProps {
  /** Noms des artistes en feat (ex: ["Balz", "Ando"]) */
  featNames: string[];
  /** Style facultatif pour le texte */
  style?: React.CSSProperties;
  /**
   * Map optionnelle nom→ID d'artiste pour rendre les noms cliquables.
   * Si non fournie, les noms s'affichent en texte simple.
   * La clé doit être en minuscules (ex: "balz" → "some-id").
   */
  artistIdMap?: Record<string, string>;
}

/**
 * Affiche les artistes "feat." comme des liens cliquables.
 * Si un artiste n'a pas d'ID connu, il apparaît en texte simple.
 */
export function FeatArtistLinks({ featNames, style, artistIdMap }: FeatArtistLinksProps) {
  const navigate = useNavigate();

  const handleClick = useCallback((artistId: string) => {
    navigate(`/artist/${artistId}`);
  }, [navigate]);

  // Construire une fonction de lookup locale (évite dépendance au contexte)
  const findArtistId = useCallback((name: string): string | null => {
    if (!name || !artistIdMap) return null;
    return artistIdMap[name.trim().toLowerCase()] ?? null;
  }, [artistIdMap]);

  if (!featNames || featNames.length === 0) return null;

  return (
    <span style={{ color: 'var(--color-text-muted)', fontSize: 13, ...style }}>
      {' '}feat.{' '}
      {featNames.map((name, index) => {
        const artistId = findArtistId(name);
        const isLast = index === featNames.length - 1;
        const separator = isLast ? '' : ', ';

        if (artistId) {
          return (
            <span key={`${name}-${index}`}>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  handleClick(artistId);
                }}
                style={{
                  color: 'var(--color-accent)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  textDecoration: 'none',
                  transition: 'opacity 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = '0.7';
                  e.currentTarget.style.textDecoration = 'underline';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = '1';
                  e.currentTarget.style.textDecoration = 'none';
                }}
                role="link"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleClick(artistId);
                  }
                }}
              >
                {name}
              </span>
              {separator}
            </span>
          );
        }

        // Artiste non trouvé → texte simple
        return (
          <span key={`${name}-${index}`}>
            <span style={{ fontWeight: 500 }}>{name}</span>
            {separator}
          </span>
        );
      })}
    </span>
  );
}


