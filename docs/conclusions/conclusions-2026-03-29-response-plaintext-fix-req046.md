# Conclusions — 2026-03-29 — Response Format Fix: Plaintext statt JSON (REQ-046)

## Kontext

Nach erfolgreichem Plugin-Load und während der Testphase fiel auf, dass Command-Responses noch in JSON-Objekt-Form zurückkamen:

```json
{
  "response": "Loading video... Bot will appear in channel shortly."
}
```

Nach REQ-046 sollen Responses aber als reiner Plaintext ausgegeben werden — kein JSON, kein Markdown, keine strukturierten Formate.

---

## Ursache

In `src/index.ts` gab es einen Legacy-Compatibility-Wrapper, der alle Command-Ergebnisse zu `{ response: string }` konvertierte. Das war eine Zwischenlösung aus der älteren Sharkord-SDK-Phase.

---

## Umsetzung

Datei: `src/index.ts` (Zeile ~1321)

Der Command-Register Wrapper (`execute` Funktion) wurde geändert:

**Vorher:**
```typescript
const execute = async (...): Promise<{ response: string }> => {
  ...
  return { response: maybeResponse };
  return { response: message };
}
```

**Nachher:**
```typescript
const execute = async (...): Promise<string> => {
  ...
  return maybeResponse;
  return message;
}
```

- Alle Rückgabewerte werden nicht mehr zu `{ response: ... }` gewrapped
- Commands geben jetzt direkt den Plaintext String zurück
- Fehlerbehandlung bleibt, aber wirft nur den rohen Fehlermeldungs-String zurück

Traceability:
- REQ-046: Bot-Antworten als Klartext

---

## Verifikation

1. Build erfolgreich: `bun run build`
2. Integrations-Regressionstests: `21 pass, 0 fail` ✓
3. Docker-Deploy erfolgreich mit neuer Version: `alpha.10-290326-21-17-32`

---

## Erwarteter Effekt

Command-Responses erscheinen jetzt im Chat als reiner Plaintext:

**Statt:**
```
Response
{
  "response": "Loading video..."
}
```

**Jetzt:**
```
Loading video...
```

Dadurch ist die Nutzer-Erfahrung konsistent mit REQ-046 ✓
