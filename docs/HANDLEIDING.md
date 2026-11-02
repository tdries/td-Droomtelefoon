# Droomtelefoon · handleiding voor de gastheer

Partyspel voor 2 tot 12 spelers (ideaal 6 tot 10), 2 tot 3 uur. De tv is het bord, de laptop (of een iPhone) is de roze Droomtelefoon, ieders eigen gsm is het notitieboekje. Ontwerp: [design.md](design.md).

## Starten: dubbelklik

1. Download de map (groene knop **Code** › **Download ZIP** op GitHub) en pak ze uit.
2. Dubbelklik **Start Droomtelefoon.command** (Mac) of **Start Droomtelefoon.bat** (Windows).
   - Mac, de eerste keer: rechtsklik › **Open** › **Open**. Apple vraagt dat bij elk programma dat van het internet komt.
   - Windows: "Windows heeft uw pc beschermd" › **Meer info** › **Toch uitvoeren**.
3. Plak je Claude API-sleutel (maak er een op platform.claude.com › API keys). Leeg laten = demo zonder AI.
4. Er openen twee tabbladen: het **bord** (sleep het naar de tv, volledig scherm) en de **Droomtelefoon** (blijft op de laptop: de microfoon en luidspreker van de laptop zijn de telefoon). Druk op **Uitleg ▶** en daarna op **Start het spel**.

De eerste keer zet de starter Node.js in de spelmap als die nog niet op de computer staat (± 50 MB) en vraagt hij de sleutel; die komt in `.env`, alleen leesbaar voor jou. Op een Mac blijven computer en scherm wakker zolang het spel loopt. Venster sluiten = spel stoppen.

Zet een maandlimiet op je Claude-account (platform.claude.com › Billing › Spend limits). Bereik je die tijdens het spel, dan zeggen de aanbidders "slechte verbinding" tot je de limiet verhoogt.

## Klaarzetten

Alles gebeurt op de tv bij het starten van een spel:

1. Hoeveel spelers (2 tot 12, ideaal 10).
2. Hun namen.
3. Per speler: leeftijd, man/vrouw/anders, valt op mannen/vrouwen/allebei, en 3 crushes. Crush 1 wordt hun teamgenoot.
4. Claude zoekt per speler 10 wereldberoemde, knappe sterren die op hun hoogtepunt waren toen die speler 12 tot 25 was, passend bij wie ze leuk vinden. De crushes zelf zitten er niet bij. Alle spelers tegelijk, een paar minuten.

Daarna zoekt de laptop (alleen op een Mac) voor elke teamgenoot een profielfoto op Wikipedia (bij een personage zoals Harry Potter kiest Claude de acteur; bron en licentie staan in `avatars/credits.json`) en tekent hij lokaal neon-popartportretten van alle aanbidders, en van teamgenoten zonder foto (optioneel, met mflux op een Mac met Apple-chip, ~11 s per stuk). Tot een portret klaar is tonen bord en gsm's initialen of een silhouet. Aanbidders krijgen geheime bestandsnamen, zodat niemand via de site kan uitproberen welke sterren meedoen. Zelf starten kan ook: `./start.sh portretten`. Een foto vervangen: zet een eigen vierkante foto als `avatars/co-<naam>.jpg` (bv. `co-pamela-anderson.jpg`).

"Spelers aanpassen" in de lobby opent de wizard opnieuw. Alleen spelers met gewijzigde gegevens krijgen nieuwe aanbidders.

## spelers.xlsx

In de projectmap staat altijd `spelers.xlsx` met alle spelers, hun crushes en hun 10 aanbidders met hints. Het wordt na elke wijziging bijgewerkt.

- **Aanpassen:** open het (of klik "Open spelers.xlsx" op de tv), wijzig, bewaar. In de lobby of de setup leest het spel het meteen in; tijdens een spel pas na "Reset".
- **Volledige rij:** blijft zoals hij is. **Alleen een naam:** Claude schrijft de hints. **Minder dan 10 rijen:** Claude vult aan.
- **Andere situatie:** knop "Excel inladen" op de tv, of vervang het bestand in de map. Inladen kan alleen vanaf de laptop zelf, niet vanaf een gsm.
- Het blad "Uitleg" in het bestand legt alle kolommen uit.

## Voor gevorderden: start.sh

```bash
./start.sh
```

`start.sh` zoekt de sleutel in deze volgorde: de omgevingsvariabele `ANTHROPIC_API_KEY`, het bestand `.env`, en anders 1Password (`OP_REF="op://..." ./start.sh`, dan komt de sleutel nooit op schijf). Hij stopt ook een draaiende server (en vraagt het eerst als er een spel bezig is).

Lokale Vlaamse stemmen (Piper, Qwen, OmniVoice; te kiezen in de "Stem"-badge op de Droomtelefoon) komen van een tweede proces op een Mac met Apple-chip: `voices/download.sh` haalt de Piper-stemmen op, daarna `python voice_server.py piper qwen omnivoice` in een Python-omgeving met `mlx-audio` en `piper-tts` (poort 8792). Zonder stemserver kies je "iPhone": dan spreekt de browser zelf.

- TV / laptop: `http://localhost:3000`
- Droomtelefoon op de laptop: `http://localhost:3000/phone`. Of een iPhone als Droomtelefoon (zie hieronder): `https://<laptop-ip>:3443/phone` → "ZET AAN" (ontgrendelt geluid en stem, houdt het scherm aan). Gaat hij over: groene knop "Opnemen". De tv rinkelt mee tot er wordt opgenomen en meldt het als er geen Droomtelefoon verbonden is.
- Spelers: QR op de tv of `http://<laptop-ip>:3000/play`. Gaat de Droomtelefoon over voor jou, dan kan je ook opnemen met de groene knop op je eigen gsm, en in de rondes waarin je zelf belt kies je het nummer ook op je gsm; stem en microfoon blijven op de Droomtelefoon. Een teamgenoot geeft alleen een tip: in dat gesprek zijn er geen vragen of invoerveld.

`ROUNDS=8 ./start.sh` voor een avond van 2 uur.

Soundcheck vóór de avond: `./start.sh check` speelt een kort gesprek en een sms met tijden (als de tweede speler, zodat jouw eigen aanbidders geheim blijven).

Spelers krijgen het spel niet geopend op hun gsm? Laat ze de QR-code scannen met de gewone camera (niet vanuit WhatsApp of een QR-app), op Xiaomi/Redmi Chrome gebruiken in plaats van de eigen browser, `http://` mee typen, en een VPN uitzetten.

## iPhone als Droomtelefoon

Wil je een echte telefoon in het midden van de tafel, dan kan een iPhone de Droomtelefoon zijn. Een browser geeft de microfoon alleen vrij via https, dus dat vraagt een eenmalige opzet:

1. Installeer mkcert op de laptop (`brew install mkcert`) en draai `mkcert -install`.
2. Start met `./start.sh`: die maakt een certificaat voor het adres van de laptop en zet https aan op poort 3443.
3. Op de iPhone, in Safari: open `http://<laptop-ip>:3000/ca.pem`, sta het profiel toe, installeer het via Instellingen › Algemeen › VPN en apparaatbeheer, en zet het aan via Instellingen › Algemeen › Info › Certificaatvertrouwensinstellingen.
4. Open daarna `https://<laptop-ip>:3443/phone` op de iPhone. Wie de http-link opent, wordt er automatisch naartoe gestuurd. Microfoon altijd toestaan: tik "aA" in de adresbalk › Website-instellingen › Microfoon › Sta toe.

## Snelheid

Tussen twee gesprekken rust het bord 10 tot 20 seconden (willekeurig), zodat de avond niet jaagt. "Beurt overslaan" twee keer tikken start het volgende gesprek meteen.

Gesprekken draaien op Claude Opus 5.5. Opnemen is meteen: de openingszin wordt al gemaakt terwijl de telefoon rinkelt. Een antwoord duurt ongeveer 3 s; de Droomtelefoon zegt meteen "Hmm…" om de stilte te vullen. Zelf bellen laat een kiestoon horen tot de aanbidder opneemt. Een naam die toch ontsnapt wordt een *piep*.

`TALK_MODEL=claude-haiku-5-5 ./start.sh` is sneller, maar Haiku verklapte in de test meteen de naam van de aanbidder. Niet aangeraden.

## Hints moet je verdienen

Een aanbidder begint nooit met een hint. Hints komen alleen van echte vragen die je hardop stelt, of van een antwoord op een wedervraag die de aanbidder gewoon in het gesprek stelt. Er zijn geen opdrachten of knoppen meer om aan te klikken.

Aanbidders onthouden eerdere gesprekken en sms'en. Foute gokken staan met naam op de tv.

## Pauze

De knop "Pauze" bovenaan de tv zet het hele spel stil: de gesprekstijd, het rinkelen, de rust tussen gesprekken en het steelmoment. De tv toont een groot pauzescherm, de Droomtelefoon stopt met rinkelen en luisteren, en de gsm's tonen "PAUZE". "Verder spelen" gaat precies verder waar het stopte.

## Uitleg

De knop "Uitleg ▶" in de lobby (en "Uitleg" bovenaan tijdens het spel) start op de tv een diavoorstelling van negen dia's die het hele spel uitlegt, voorgelezen door de Vlaamse Piper-stem van de stemserver (zonder stemserver: de stem van de laptop). Ze loopt vanzelf door; pijltjes, spatie en Esc werken ook. Duurt ongeveer drie minuten.

## Steelmoment

Elke 10 minuten verschijnt op elke spelersgsm 45 seconden lang een grote pop-up "STEEL AANBIDDER". Ken je de naam van de aanbidder van iemand anders, omdat je goed meeluisterde? Kies die speler, het nummer en typ de naam: juist is +5 en die aanbidder is weg voor de ander, fout is −2. Eén poging per steelmoment. Testen met een korter interval: `STEAL_MINUTES=1 ./start.sh`.

## Stemmen, beltonen en gezichten

- **Eigen stem per personage.** Elke teamgenoot en elke aanbidder krijgt een vaste, unieke combinatie van Nederlandse stem, toonhoogte en tempo. Vrouwen spreken met een vrouwenstem, mannen met een mannenstem. Verbeterde/Premium-stemmen worden eerst gekozen, Vlaamse eerst.
- **Mooiere stemmen op de iPhone:** Instellingen → Toegankelijkheid → Gesproken materiaal → Stemmen → Nederlands: download Ellen, Claire en Xander in de *verbeterde* versie.
- **Beltonen.** Twintig beltonen in het Nokia-formaat van de jaren 90 (vrije melodieën en klassieke telefoonsignalen). Elke oproep neemt de volgende uit een geschudde stapel; de naam staat op het belscherm. De tv rinkelt alleen als er geen Droomtelefoon verbonden is.
- **Pratende teamgenoot.** Bij een gesprek met de teamgenoot en bij de begroeting toont de Droomtelefoon een groot gezicht waarvan de kaak meebeweegt met de stem. De mond wordt gevonden met de gezichtsherkenning van macOS (`mouth.js`).
- **Gesprekstijd:** 45 seconden met een aanbidder, 20 met de teamgenoot. De klok staat stil tijdens een opdracht.
- **Raden.** Kleine tikfouten en een fonetische schrijfwijze tellen (Britny Spears, Zak Efron). Bij twijfel beslist Claude. Een andere persoon blijft fout.

## Test

```bash
node test.js
```
Draait in een tijdelijke map zonder API-key; je echte spelers blijven onaangeroerd.
