# Calender

Persoonlijke studie- en takenagenda voor desktop en gsm.

## Functies
- Maand-, week- en dagweergave
- Taken, deadlines, evenementen, lessen en studieblokken
- Beschikbare leermomenten tekenen
- Klassen/vakken met eigen kleuren
- Vandaag/morgen/deadlines in de zijbalk
- Studie- en planningsstatistieken
- VUB TimeEdit-rooster als read-only externe agenda
- Mobielvriendelijke/PWA-layout

## VUB TimeEdit
De workflow `.github/workflows/update-timeedit.yml` haalt je publieke TimeEdit-feed automatisch op en bewaart hem als `data/vub.ics`. De workflow draait bij sitewijzigingen, handmatig en vervolgens elke 3 uur.

## Publiceren met GitHub Pages
Ga in deze repository naar:

**Settings → Pages → Build and deployment → Deploy from a branch → main / (root)**

De site wordt dan bereikbaar op:

https://hugo28j.github.io/Calender/

## Opslag
Eigen taken en beschikbaarheden worden momenteel in `localStorage` van de browser bewaard. Ze blijven dus op hetzelfde toestel/browser bewaard. Voor echte synchronisatie tussen gsm en pc is later nog een online database/login nodig.
