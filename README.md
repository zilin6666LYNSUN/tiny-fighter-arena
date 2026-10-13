# Tiny Fighter Arena

Describe a fighter in one line. AI brings it to life — portrait, powers, weakness, trash-talk — and sends it into a short commentated battle against the arena's resident champions.

Built as a **Pollinations BYOP** demo: the app uses the [Bring Your Own Pollen](https://github.com/pollinations/pollinations/blob/main/BRING_YOUR_OWN_POLLEN.md) OAuth authorization-code flow (PKCE S256) to let each player authorize spending **their own Pollen** on generation requests. No backend, no API keys bundled in the repo — 100% static, runs on GitHub Pages.

## How it works

1. **Connect wallet** — the app redirects to Pollinations' consent screen. After approval the user gets a scoped `sk_...` key (kept in `sessionStorage`, never in the URL or localStorage) with a configurable budget (default 12 Pollen, text+image models, 7-day expiry).
2. **Forge a fighter** — one sentence becomes a JSON fighter profile (`gpt-5.4-nano`) plus a chibi-style portrait (`flux`).
3. **Battle** — up to 6 commentated rounds. Each round the text model narrates actions (damage/heal/miss), respecting powers, weaknesses and stats.
4. **Report** — the announcer writes the official battle report; copy it or share the `?f=<description>` link to prefill a rematch.

## Run locally

```bash
# any static server works
python -m http.server 8000
# open http://localhost:8000
```

## Deploy to GitHub Pages

1. Push this repo to GitHub (public).
2. Repo → Settings → Pages → deploy from `main` branch `/` root.
3. (Recommended) Create a **publishable App Key** at [enter.pollinations.ai/keys](https://enter.pollinations.ai/keys) with:
   - Name: `Tiny Fighter Arena`
   - Redirect URI: `https://<your-username>.github.io/tiny-fighter-arena/`
4. Put the `pk_...` key in `app.js` → `APP_KEY`. Without it the consent screen falls back to the redirect hostname and traffic is not attributed.

## Tech

- Vanilla JS SPA (no build step)
- Pollinations APIs: `POST /v1/chat/completions`, `POST /v1/images/generations`
- OAuth: `https://enter.pollinations.ai/authorize` + `/api/oauth/token` (PKCE S256)
- Models: `openai/gpt-5.4-nano` (text), `flux` (image)

## Note

The user-authorized key defaults to 7 days; users can revoke it anytime from their Pollinations dashboard. Requests are billed to the **user's** balance — the app never holds or pays with its own key.
