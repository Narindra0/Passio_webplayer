# Pass'io Mobile

Application mobile lecteur de la plateforme Pass'io.

## But

Cette app sert au fan pour:

- activer un achat avec un `PassCode`
- acceder a sa bibliotheque perso
- preparer la lecture audio securisee
- stocker les donnees sensibles dans le sandbox de l'application
- recevoir les mises a jour OTA via EAS Update

## Stack

- React Native
- Expo SDK 54
- TypeScript / TSX
- Expo Router
- EAS Update

## Structure

```text
mobile/
├── app/            routes Expo Router
├── components/     composants UI reutilisables
├── services/       API, stockage, infos app, audio
├── types/          types partages
├── assets/         images et icones
├── app.json        configuration Expo
├── eas.json        profils EAS Build / Update
└── .env.example    variables d'environnement
```

## Installation

```bash
cd mobile
npm install
```

## Lancement

```bash
npm run start
```

## Builds

```bash
npm run android
npm run ios
```

### Production Android (arm64)

```bash
npm run build:android:apk   # APK sideload (profil production-apk)
npm run build:android:aab   # AAB Google Play (profil production-aab)
```

Les builds **production** / **production-apk** / **production-aab** injectent via [`eas.json`](eas.json) :

- `EXPO_PUBLIC_API_URL=https://pass-io.onrender.com`
- `EXPO_PUBLIC_PURCHASE_BASE_URL=https://passiio.shop`

Mesure locale du bundle JS :

```bash
npm run export:android
npm run size:android
```

## Variables d'environnement

```env
EXPO_PUBLIC_API_URL=http://localhost:3001
EXPO_PUBLIC_APP_ENV=development
EXPO_PUBLIC_EAS_CHANNEL=preview
EXPO_PUBLIC_PURCHASE_BASE_URL=https://passiio.shop
```

## Important pour le reseau

- sur un emulateur Android, `10.0.2.2` pointe vers ton PC
- sur un vrai telephone, `localhost` ne marche pas
- dans ce cas, mets l'IP LAN de ton PC dans `EXPO_PUBLIC_API_URL`, par exemple `http://192.168.1.20:3001`

## EAS Update

Le projet est lie a un projet Expo et configure pour EAS Update.

- projet Expo: `@toavinasixseven/passio-mobile`
- channel de preview: `preview`
- channel de production: `production`

Commandes utiles:

```bash
eas update --channel preview
eas update --channel production
```

## Ecrans

- `Bibliotheque`: albums publics charges depuis le backend
- `Activer`: saisie du `PassCode`
- `Profil`: infos appareil, app, backend et canal
- `Lecteur securise`: lecture des pistes de l album active
