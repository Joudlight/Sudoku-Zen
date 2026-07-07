# Sudoku Zen 🧩

A polished, free daily sudoku game built as a single-page web app.  
Play online: [sudokuzen.app](https://sudokuzen.app) (or your GitHub Pages URL)

## Features

- **4 Difficulty Levels** — Easy, Medium, Hard, Expert
- **Dark / Light Mode** — Auto-detects system preference, remembers your choice
- **Sound Effects** — Web Audio API tones (toggle on/off)
- **Keyboard Shortcuts** — Full keyboard control (1-9, arrows, N, H, Z, P, ?)
- **Undo System** — Step back through your last 30 moves
- **Auto-Save** — Game state persisted in localStorage (survives page refresh)
- **Statistics** — Track games played, won, best times, streaks
- **Combo System** — Consecutive correct placements earn bonus points
- **Pause** — Freeze timer and blur the board
- **Confetti** — Celebration animation on puzzle completion
- **Progress Bar** — Visual fill with animated shimmer
- **Responsive** — Works on desktop, tablet, and mobile
- **PWA Ready** — Manifest included for "Add to Home Screen"

## Deployment (GitHub Pages)

1. Push this folder to a GitHub repo
2. Go to **Settings → Pages**
3. Set source to **Deploy from branch: main, / (root)**
4. Your site will be live at `https://<username>.github.io/<repo>/`

Optional: Set up a custom domain in the Pages settings.

## Monetization

Ad slots are marked with `class="ad-slot"` in the HTML.  
To add Google AdSense:
1. Get approved for AdSense
2. Replace the placeholder in `ads.txt` with your publisher ID
3. Insert the AdSense ad unit code inside the `.ad-slot` divs

## SEO Notes

- Open Graph tags for social sharing
- JSON-LD structured data for search engines
- Sitemap and robots.txt included
- Semantic HTML5 elements

## Tech Stack

- Vanilla JavaScript (no frameworks)
- CSS Custom Properties (theme system)
- Web Audio API (sound synthesis)
- localStorage (persistence)
- Google Fonts (DM Serif Display + DM Sans)

## License

MIT — free to use, modify, and share.
