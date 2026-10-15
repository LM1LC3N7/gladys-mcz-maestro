# MCZ Maestro (poêles à granulés)

Les poêles à granulés MCZ équipés de la technologie **Maestro** ou
**Maestro+** se pilotent avec l'application **MCZ MAESTRO**, à travers le
cloud MCZ. Cette intégration se connecte à ce cloud avec le compte de votre
application, comme le fait l'application, et amène vos poêles dans Gladys :
les allumer et les éteindre, régler la température, la puissance et les
ventilateurs, activer les modes éco et silence, suivre les températures,
l'état et les alarmes, et réagir à une alarme dans une scène.

**Non officiel** : sans lien avec MCZ Group.

> **Version de développement (0.1).** Construite sur le protocole cloud de
> l'intégration Home Assistant utilisée par de nombreux propriétaires de
> poêles MCZ, et testée avec des réponses calquées sur celles de vrais poêles,
> pas encore avec un vrai poêle. Vos retours sont les bienvenus sur le dépôt
> GitHub.

## Quels poêles

- Les poêles **Maestro+** (Wi-Fi et Bluetooth, application « Maestro+ MCZ ») :
  modèles à air et hydro comme Cute, Tecla, Ego, Star, Club, Mood, Jazz, Aki,
  Pad…
- Les poêles **Maestro** de première génération, une fois passés sur un
  compte avec l'application « MCZ Maestro – Upgrade ».

**Pas cette intégration** :

- Les poêles MCZ **Easy Connect** (ancien module Micronova) : utilisez
  l'intégration **Micronova Agua IOT**, application « Easy Connect », « Easy
  Connect Plus » ou « Easy Connect Poêle ».
- Les poêles Palazzetti ont leur propre intégration Gladys.

## Ce que vous obtenez

Un appareil Gladys par poêle du compte, avec les fonctions que propose le
modèle du poêle :

| Fonction               | Dans Gladys                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------- |
| Marche/arrêt           | mode du thermostat : arrêt / marche                                                 |
| Consigne               | consigne du thermostat, dans les bornes du modèle, par pas de 0,5 °C                |
| Chauffe                | état de fonctionnement : le poêle produit de la chaleur ou non                      |
| Température ambiante   | capteur de température (°C)                                                         |
| Température des fumées | capteur de température (°C)                                                         |
| État                   | texte : éteint, allumage, chauffe, nettoyage, veille, extinction, alarme…           |
| Alarme                 | capteur binaire : 1 tant que le poêle est en alarme                                 |
| Dernière alarme        | texte : le code de la dernière alarme et sa signification (« A01 : Échec de… »)     |
| Puissance              | un choix parmi les niveaux de puissance (1 à 5)                                     |
| Ventilateurs           | un choix par ventilateur (ambiant, canalisés) : arrêt, vitesse 1 à 5, auto, silence |
| Mode éco               | interrupteur : le mode Start & Stop (le poêle s'arrête et repart tout seul)         |
| Mode silence           | interrupteur, sur les poêles de première génération                                 |
| Granulés bas           | capteur binaire, quand le capteur de niveau de granulés du poêle est activé         |

Sur un Maestro+, le mode silence est la valeur « Silence » du ventilateur.

L'état se lit comme « Chauffe (Potenza 3) » : la phase d'abord, la même pour
tous les poêles, puis le texte du poêle lui-même quand il en envoie un.

Les ventilateurs suivent le mode de travail du poêle, comme dans
l'application : en **manuel** (et dynamique/auto) vous choisissez leur
vitesse, en **confort** et **nuit** c'est le poêle qui les pilote, et Gladys
vous le dit si vous essayez.

## Installation

1. Vérifiez que votre poêle fonctionne dans l'application MCZ MAESTRO sur
   votre téléphone.
2. Dans la configuration de l'intégration, saisissez l'**e-mail** et le
   **mot de passe** de cette application.
3. Cliquez sur **Tester la connexion** : les poêles du compte sont listés.
4. Ouvrez l'onglet **Découverte** et ajoutez vos poêles.

## Options

| Option                     | Défaut   | Rôle                                                                                       |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| Langue des textes du poêle | Français | noms des fonctions, textes de l'état et des alarmes                                        |
| Intervalle de lecture      | 60 s     | fréquence de lecture de chaque poêle (60 à 3600 s) : chaque lecture sollicite le cloud MCZ |

## Scènes

Le déclencheur **Alarme du poêle** se déclenche quand un poêle passe en
alarme (allumage raté, flamme éteinte, fumées trop chaudes, conduit
obstrué…), une fois par alarme. Laissez le poêle vide pour les surveiller
tous. La scène reçoit le nom du poêle, le code de l'alarme (« A01 »…) et sa
signification, l'état, et une phrase prête à envoyer, par exemple « Poêle
salon : alarme du poêle (A01 : Échec de l'allumage) » à envoyer en
notification.

Les fonctions s'utilisent dans les scènes comme n'importe quel appareil :
allumer le poêle à 6 h 30, régler la consigne quand vous partez, activer le
mode éco la nuit, tester la température ambiante dans une condition…

## Fonctionnement

- Gladys parle au cloud MCZ (`s.maestro.mcz.it`) par Internet, jamais
  directement au poêle : le poêle doit être en ligne dans l'application.
  Chaque lecture demande au cloud de joindre le poêle, puis lit son état ;
  une minute est l'intervalle le plus court, pour rester courtois avec le
  cloud MCZ.
- L'e-mail et le mot de passe restent dans la configuration de Gladys (le
  mot de passe est un champ secret) et ne sont envoyés qu'au cloud MCZ.
- Les commandes suivent le modèle du poêle, tel que le cloud le décrit :
  seules les fonctions de votre poêle sont proposées. Gladys affiche la
  nouvelle valeur tout de suite et relit le poêle 5 secondes plus tard pour
  la confirmer.
- Sur un Maestro+, la commande marche/arrêt est un appui sur le bouton
  d'alimentation : Gladys ne l'envoie que si le poêle est dans l'autre état.
- Une connexion refusée est retentée au bout de 15 minutes, ou dès que vous
  enregistrez la configuration. Le cloud MCZ connaît des pannes de temps en
  temps : l'intégration l'affiche injoignable et se reconnecte toute seule.

### Mode local

Les poêles Maestro de première génération ouvrent aussi leur propre point
d'accès Wi-Fi avec une websocket locale (`ws://192.168.120.1:81`), et les
poêles Maestro+ parlent Bluetooth avec l'application. Aucun des deux n'est
utilisé : Gladys fait tourner l'intégration dans un conteneur sur votre
réseau, qui ne peut ni rejoindre le point d'accès du poêle ni utiliser le
Bluetooth. Des projets comme maestrogateway relaient la websocket locale vers
MQTT, si vous voulez vous passer du cloud.

## Dépannage

- **« a refusé l'e-mail ou le mot de passe »** : vérifiez-les dans
  l'application MCZ MAESTRO. Un compte Easy Connect ne fonctionne pas ici
  (voir plus haut).
- **Aucun poêle** : le poêle a été ajouté avec un autre compte. Connectez-vous
  à l'application avec le même e-mail.
- **Un poêle injoignable, « pas connecté au cloud MCZ »** : le poêle a perdu
  son Wi-Fi ou son alimentation : vérifiez-le dans l'application.
- **Un réglage de ventilateur est refusé** : le poêle est en mode confort ou
  nuit, ou son mode silence est actif : changez-le dans l'application ou
  désactivez le mode silence.
- **« Granulés bas » ne change jamais** : le poêle ne transmet peut-être pas
  son capteur de granulés au cloud (l'application signale le réservoir vide
  par ses propres notifications). Dites-nous sur GitHub ce que fait votre
  poêle.

## Remerciements

Le protocole cloud et les noms des commandes du poêle viennent de
l'intégration Home Assistant [maestro_mcz](https://github.com/Robbe-B/maestro_mcz)
de Robbe-B et ses contributeurs (licence Apache 2.0). Les états historiques
des poêles Maestro et les codes d'alarme sont documentés par
[maestrogateway](https://github.com/Chibald/maestrogateway) (Chibald).
