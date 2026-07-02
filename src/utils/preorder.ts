/**
 * Utilitaires pour le système de précommande Pass'io.
 * Un album est en précommande si sa publication_date est dans le futur.
 */

/**
 * Vérifie si un album est en précommande (publication_date dans le futur).
 */
export function isPreorder(publicationDate?: string | null): boolean {
  if (!publicationDate) return false;
  const pubDate = new Date(publicationDate);
  const now = new Date();
  return pubDate > now;
}

/**
 * Calcule le temps restant avant la sortie d'un album.
 * Retourne un objet avec days, hours, minutes, seconds.
 */
export function getRemainingTime(publicationDate: string): {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
} {
  const diff = new Date(publicationDate).getTime() - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };

  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((diff / (1000 * 60)) % 60),
    seconds: Math.floor((diff / 1000) % 60),
  };
}

/**
 * Formate le temps restant en texte lisible.
 * Ex: "Dans 3 jours", "Dans 12h", "Dans 45 min"
 */
export function formatRemainingTime(publicationDate: string): string {
  const { days, hours, minutes } = getRemainingTime(publicationDate);

  if (days > 7) return `Sortie dans ${days} jours`;
  if (days > 0) {
    const h = hours > 0 ? ` ${hours}h` : '';
    return `Sortie dans ${days} jour${days > 1 ? 's' : ''}${h}`;
  }
  if (hours > 0) {
    return `Sortie dans ${hours}h${minutes > 0 ? ` ${minutes}min` : ''}`;
  }
  if (minutes > 0) return `Sortie dans ${minutes} min`;
  return 'Sortie imminente…';
}

/**
 * Formate la date de sortie en français lisible.
 * Ex: "25 décembre 2024"
 */
export function formatPublicationDate(publicationDate: string): string {
  const date = new Date(publicationDate);
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
