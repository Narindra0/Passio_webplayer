# 🔍 Diagnostic — Système de comptage des streams (Pass'io Web Player)

> Analyse réalisée le 2026-07-16 — basée sur le code source complet du dépôt.

---

## 1. Tous les points d'écoute

| Point d'écoute | Déclencheur | Stream compté ? |
|---|---|---|
| **Web — album/EP premium** (MSE Secure Player) | Fin de piste naturelle (`ended`) | ✅ Oui — via `recordTrackEnded` |
| **Web — album/EP premium** (Secure Audio Player / Web Audio API) | Fin de piste (`onEnded`) | ✅ Oui |
| **Web — album/EP premium** (HTML5 Audio fallback) | Fin de piste (`audio ended`) | ✅ Oui |
| **Web — album free** (stream direct Cloudflare ou cache IndexedDB) | Fin de piste (`audio ended`) | ✅ Oui |
| **Web — mode autoplay/radio** (piste recommandée) | Fin de piste | ✅ Oui (même chemin) |
| **Web — fichiers locaux (device)** | `playDeviceFile` → `audio ended` | ❌ **Non** — aucun `recordTrackEnded` appelé |
| **Mobile natif** (si app mobile existe) | Inconnu — code hors dépôt | ❌ **Non couvert** côté worker |

---

## 2. Comment fonctionne le système de comptage

### Architecture globale

```
Navigateur (React/TS)
    ↓  recordTrackEnded(trackId, fromTrackId)
streamTracker.ts
    ↓  POST /api/v1/streams   { trackId, fromTrackId }
Cloudflare Worker (streams-api.ts)
    ↓  Déduplication KV → Incrément KV → Transition KV
KV Namespace (STREAMS_KV)
```

Deux couches coexistent :

| Couche | Endpoint | Stockage | But |
|---|---|---|---|
| **V1** | `POST /api/v1/streams` | KV (`v2:cnt:{trackId}`) | Compteur public + recommandations collaboratives |
| **V2** | `POST /api/v2/events` | D1 SQLite (`track_events`) | Analytics enrichi (progression, skip, taux de complétion) |

### Où est stockée l'écoute ?

**V1 (compteur principal) — Cloudflare KV :**
- Clé : `v2:cnt:{trackId}` → valeur : entier en string `"42"`
- Clé transition : `v2:trans:{fromTrackId}:{toTrackId}` → score
- Clé best : `v2:best:{fromTrackId}` → JSON `{ trackId, score }`
- Clé dédup : `v2:dedup:{date}:{trackId}:{deviceId}` → `"1"` (TTL 48h)

**V2 (analytics) — Cloudflare D1 :**
- Table `track_events` : `(session_id, track_id, event_type, progress_pct, duration_sec, created_at)`
- Types d'events : `ended`, `progress`, `skip`
- Rétention : 90 jours, purge cron quotidienne

**Local (historique artiste) — localStorage :**
- Clé : `passio_listening_history` → objet `{ artistId: { playCount, lastPlayedAt } }`
- Déclenché à chaque **début** de piste (pas à la fin), via `recordArtistPlay`
- Purement local, jamais envoyé au serveur

### Ce qui déclenche l'enregistrement

| Événement | Ce qui est enregistré |
|---|---|
| **Piste terminée naturellement** (100%) | `recordTrackEnded` (V1 KV) + `recordTrackProgress(1.0, ...)` (V2 D1) |
| **Skip manuel** (< 90% de progression) | `recordTrackSkip` (V2 D1) seulement — **pas de V1** |
| **Paliers de progression** (25%, 50%, 75%, 90%) | `recordTrackProgress` (V2 D1) seulement |
| **Début de piste** | `recordArtistPlay` (localStorage) uniquement |

> **Point crucial :** le compteur officiel (V1 KV) n'est incrémenté **que si la piste se termine naturellement** (`advanceToNextTrack`). Un skip ne compte pas.

---

## 3. Couverture Web vs Mobile

### Web ✅
Entièrement couvert. Le chemin est :
1. `audio.ended` ou `secureAudioPlayer.onEnded` ou `mseSecurePlayer.onEnded`
2. → `currentTrackEndHandler()` (défini dans `AudioContext.tsx` ligne 644)
3. → `advanceToNextTrack()` → `recordTrackEnded()`

### Mobile natif ❌
**Il n'y a aucun code mobile dans ce dépôt.** Si une application mobile (React Native, Flutter, etc.) existe dans un autre dépôt, elle n'est pas connectée au Worker KV/D1. Le Worker Cloudflare est en théorie accessible depuis n'importe quel client HTTP, mais il n'y a aucune preuve d'intégration mobile.

---

## 4. Déduplication — Protection anti-double comptage

### Mécanisme en place (V1 KV)
La clé de déduplication : `v2:dedup:{YYYY-MM-DD}:{trackId}:{deviceId}`
- TTL : **48h** (2 jours)
- Logique : si la clé existe → retourne `{ counted: false, reason: 'duplicate' }` sans incrémenter

**Ce que ça protège :**
- Un même device qui écoute la même piste plusieurs fois dans la même journée (J et J+1) → compte 1 seul fois sur 48h

**Ce que ça ne protège PAS :**
- Un utilisateur qui écoute depuis deux navigateurs différents → 2 device IDs différents → compte 2 fois
- Rechargement de page en cours d'écoute → la piste ne se termine pas → aucun stream envoyé (comportement correct)
- Boucle infinie (`repeatMode: 'one'`) → `advanceToNextTrack` n'est pas appelé → **aucun stream envoyé** (comportement correct)

### Identifiant appareil
Le `deviceId` est construit à partir de `navigator.platform + navigator.userAgent + crypto.randomUUID()` et chiffré dans le localStorage via `saveEncryptedValue`. C'est un identifiant **semi-persistant** : il disparaît si l'utilisateur vide son localStorage ou ses cookies. En navigation privée, un nouveau device ID est généré à chaque session.

---

## 5. Fiabilité et risques de comptage frauduleux

### Risques identifiés

| Risque | Criticité | Couverture actuelle |
|---|---|---|
| **Boucle de stream automatisée (bot/script)** | 🔴 Élevée | ⚠️ Partielle — déduplication 48h par device ID uniquement |
| **Multiple navigateurs / sessions** | 🟡 Moyenne | ❌ Aucune protection inter-devices |
| **DeviceId spoofing** (faux header `x-passio-device-id`) | 🔴 Élevée | ❌ Aucune validation côté Worker |
| **Replay HTTP direct** (POST `/api/v1/streams` répété) | 🔴 Élevée | ⚠️ Partielle — bloqué par dédup 48h seulement |
| **Navigation privée / reset localStorage** | 🟡 Moyenne | ❌ Nouveau device ID à chaque session |
| **Header `x-passio-consent: granted` forgé** | 🟡 Moyenne | ❌ Aucune validation serveur du consentement réel |

### Protection en place

| Protection | Status |
|---|---|
| Consentement RGPD côté client | ✅ `isTrackingAllowed()` vérifié avant chaque envoi |
| Consentement vérifié côté serveur | ✅ Le header `x-passio-consent` est vérifié dans le Worker |
| Déduplication 48h par `date:trackId:deviceId` | ✅ Effective |
| Durée minimale écoutée requise | ❌ **Absente** — la fin de piste est détectée par l'événement `ended`, sans vérifier combien de secondes ont été réellement jouées |
| Rate limiting | ❌ **Absent** côté Worker |
| Validation d'authenticité du deviceId | ❌ **Absent** — n'importe qui peut envoyer un POST avec n'importe quel device ID |

---

## 6. Ce qui n'est pas encore fait — les trous du système

### 🔴 Critiques

1. **Aucune durée minimale côtée serveur** : Un script peut envoyer `POST /api/v1/streams` directement sans avoir jamais écouté la piste. Côté client, l'événement `ended` se produit si on `seek()` à la toute fin (100%) sans avoir vraiment écouté.

2. **DeviceId non authentifié** : Le Worker accepte n'importe quel string comme device ID dans le header. Un bot peut générer des milliers de device IDs différents et contourner la déduplication.

3. **Pas de durée minimale côté client** : La déduplication par device+jour+track est correcte, mais si un utilisateur écoute 2 secondes et que l'événement `ended` est déclenché (par un seek rapide), le stream est compté.

4. **Les fichiers locaux (mode "device") ne sont pas comptés** : Selon la politique du produit, c'est peut-être voulu, mais c'est un angle mort documenté.

### 🟡 Moyens

5. **Mode `repeatMode: 'one'` (boucle) n'incrémente jamais le compteur** : c'est probablement le comportement voulu (anti-spam), mais si l'artiste veut compter chaque écoute distincte, c'est une limite.

6. **Pas d'anti-fraude inter-devices côté IP** : Cloudflare Workers donne accès à `request.headers.get('CF-Connecting-IP')`. Cette IP pourrait servir de second facteur de déduplication, mais elle n'est pas utilisée.

7. **Consentement non revérifié côté serveur** : Le Worker fait confiance au header `x-passio-consent: granted` envoyé par le client. Si le consentement est retiré entre deux requêtes en vol, celles-ci passent encore.

8. **Pas de comptage pour les skips** : `recordTrackSkip` alimente D1 (analytique), mais ne crée aucune entrée V1 KV. Si la définition d'un "stream" est "écoute d'au moins 30 secondes ou X%", ce seuil n'est pas implémenté.

### 🟢 Mineurs / A documenter

9. **Historique artiste local (localStorage) vs compteur serveur** : Il existe deux sources de vérité indépendantes. `listeningHistory.ts` enregistre par artiste au **début** de la piste (pas à la fin), sans lien avec le compteur KV.

10. **La table D1 `track_events` ne peut pas être agrégée en temps réel** : Les compteurs affichables (badge "N écoutes") viennent uniquement du KV V1. La D1 V2 est de l'analytique pur sans UI connectable directement.

11. **Pas de gestion des erreurs réseau en file d'attente** : Si le Worker est down au moment où une piste se termine, le stream est perdu silencieusement (Fire & Forget). Il n'y a pas de queue locale de retry.

---

## Résumé visuel du flux

```
Utilisateur écoute une piste
    │
    ├─ [Mode Device / fichiers locaux]
    │       → recordArtistPlay (localStorage)
    │       → ❌ Aucun stream compté côté serveur
    │
    └─ [Mode Online / streaming]
            │
            ├─ À chaque DÉBUT de piste
            │       → recordArtistPlay (localStorage)
            │       → touchAlbumAccess (LRU cache)
            │
            ├─ Aux PALIERS 25/50/75/90%
            │       → recordTrackProgress → POST /api/v2/events (D1)
            │
            ├─ En cas de SKIP (< 90%)
            │       → recordTrackSkip → POST /api/v2/events (D1)
            │       → ❌ Pas de comptage V1 KV
            │
            └─ À la FIN NATURELLE de la piste
                    → recordTrackEnded → POST /api/v1/streams (KV)
                    │       ↓ Dédup 48h OK?
                    │       → Incrément v2:cnt:{trackId}
                    │       → Enregistre transition A→B
                    → recordTrackProgress(1.0) → POST /api/v2/events (D1)
```
