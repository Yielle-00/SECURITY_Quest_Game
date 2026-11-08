# Firebase Setup — Security Quest

This guide explains how to connect Firebase to the Security Quest game.

The game can still run without Firebase. In this mode, the player's progress is saved in the browser only. After setting up Firebase, players can use their accounts to save their progress online.

---

## 1.  Create a Firebase Project
1. Pumunta sa <https://console.firebase.google.com> at mag-sign in gamit ang Google account.
2. **Add project** → ilagay ang pangalan (hal. `security-quest`) → pwedeng i-off ang Google Analytics → **Create project**.

## 2. Set Up the Web App
1. Sa project overview, i-click ang **`</>` (Web)**.
2. Lagyan ng nickname (hal. `security-quest-web`). **Huwag** i-check ang "Firebase Hosting". → **Register app**.
3. Lalabas ang `firebaseConfig`. I-copy ang laman.
4. Buksan ang **`js/firebase-config.js`** sa VS Code at palitan ang mga `PASTE_...`:

```js
window.SQ_FIREBASE_CONFIG = {
  apiKey:            "AIza...",
  authDomain:        "security-quest-xxxx.firebaseapp.com",
  projectId:         "security-quest-xxxx",
  storageBucket:     "security-quest-xxxx.firebasestorage.app",
  messagingSenderId: "1234567890",
  appId:             "1:1234567890:web:abcdef"
};
```
> Hindi secret ang mga value na ito. Pang-identify lang ito ng project mo. Ang tunay na proteksyon ay ang **Firestore rules** (Step 4).

## 3. I-on ang Authentication
1. Left menu → **Build → Authentication** → **Get started**.
2. Tab **Sign-in method** → **Email/Password** → i-on ang **Enable** (ang una lang na toggle, hindi ang "Email link") → **Save**.

## 4.  Set Up Cloud Firestore
1. **Build → Firestore Database** → **Create database**.
2. **Location:** piliin ang pinakamalapit (hal. `asia-southeast1` Singapore). Hindi na ito mapapalitan pagkatapos.
3. Piliin ang **Production mode** → **Enable**.
4. Tab **Rules** → palitan ang laman ng nasa **`firestore.rules`** (kasama sa project) → **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /players/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```
These rules allow a signed-in player to read and update their own document in the players collection.

Make sure the collection name matches the one used in the game code. If you already have other security rules, check them before replacing the existing rules.

## 5.  Run the Game
1. Open the project in VS Code.
2. Run index.html using Live Server.
3. I-check ang sign-in note: dapat **"saved online"** na ang nakasulat.
4. Register a test account and log in.
5. Sa Firebase console → **Firestore Database → Data**: dapat may `players/{uid}` document na may laman ng progress mo.
6. Subukan sa ibang browser o device: mag-log in gamit ang parehong account. Dapat nandoon pa rin ang progress.

---

## How the Files Work
| Bahagi | Ano ang ginagawa |
|---|---|
| `js/firebase-config.js` | Config ng project mo (ikaw lang ang naglalagay). |
| `js/database.js` | Lahat ng save/login. Pinipili nito ang **firebase** o **local** mode. |
| `js/game.js` | Tumatawag lang sa `SecurityQuestDB`. Hindi ito humahawak ng Firebase. |
| `firestore.rules` | Security rules na ipa-paste sa Firebase console. |

- **Username → email:** Firebase Auth ay email/password. Ang username na tina-type ng player ay ginagawang `username@securityquest.game` sa likod. Hindi ito totoong email at walang ine-email.
- **Username rules (online):** 3 hanggang 20 na letra, numero, tuldok, dash o underscore. **Password:** hindi bababa sa 6 na character.
- **Pag-save:** hindi bawat galaw ay nagsusulat sa Firestore. Pinagsasama ang mga save at isinusulat pagkalipas ng ~1 segundo, kapag nag-log out, at kapag isinara o itinago ang tab.
- **Lumang local save:** kung may account sa browser na ito na pareho ang **username at password**, awtomatikong madadala ang progress niya sa bagong online account kapag nag-register.

## Structure ng data (para sa documentation)
Collection `players`, isang document bawat player (ang document id ay ang Firebase Auth `uid`):

```
players/{uid}
  credentials   { username, createdAt, lastLogin, logins }
  character     { skin, face, hair, hairColor, shirt, pants, badge, name }
  progress      { stages: { <levelId>: { easy, medium, hard } }, unlocked: { <levelId>: true } }
                  stage = { cleared, bestCorrect, bestStars, bestTime, plays }
  rewards       { coins, lifetime, spent }
  inventory     { owned: [ itemId ], equipped: { outfit, badge } }
  notifications [ { id, type, title, body, ts, read } ]
  settings      { audio }
```

## Troubleshooting
| Nakikita mo | Dahilan / ayos |
|---|---|
| Local mode pa rin ang sign-in note | May `PASTE_...` pa sa `firebase-config.js`, o hindi na-load ang Firebase script (walang internet). Ayusin, tapos **Ctrl+Shift+R**. |
| *Email/Password sign-in is not turned on…* | Hindi pa naka-enable ang Email/Password sa Step 3. |
| *Firestore blocked this request…* | Hindi pa na-publish ang rules (Step 4) o iba ang collection name. |
| *Wrong username or password.* | Maling username/password. Para sa seguridad, iisa ang mensahe para sa unknown account at maling password. |
| *That username is taken* | May gumamit na ng username na iyon. Hindi case-sensitive ang username. |
| *Could not save online* (toast) | Offline ang player o may problema sa Firestore. Naka-keep ang progress at kusang magre-retry. |
| Nakalimutan ang password | Walang "forgot password" kasi walang totoong email. Burahin ang user sa **Authentication → Users**, tapos mag-register ulit (at burahin din ang document sa Firestore kung gusto mong malinis). |

## Current Limitations
- Client-side ang laro, kaya **technically makakapag-edit ng sarili niyang save data** ang player gamit ang browser developer tools (pinapayagan ng rules ang sariling document). Katanggap-tanggap ito para sa training/awareness game. Kung kailangan ng mas mahigpit, ilipat ang credits/progress logic sa **Cloud Functions** at huwag payagang magsulat ang client.
- Wala pang password reset, email verification, at leaderboard. Pwede itong idagdag mamaya.
