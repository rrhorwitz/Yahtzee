# Yahtzee Score Card

An Apple-styled Yahtzee score card that runs in the browser and installs to a phone's home screen as a web app. When a player scores, the card flips 180° to face the next player across the table.

## Features

- **Auto-rotating card**: after each score, the card spins to face the next player. Each player is set as *near side* or *far side* when the game is set up, and a flip button fixes the orientation if the device is placed the other way round.
- **Valid-value pickers**: tapping a box offers only legal scores (e.g. Threes: 3, 6, 9, 12, 15, or scratch).
- **Standard rules**: 35-point upper bonus at 63, +100 for each extra Yahtzee, and forced Joker rules.
- **Built-in dice roller** (optional): roll up to 3 times, tap dice to hold them, and see live score previews on every box. Joker rules and Yahtzee bonuses are applied automatically.
- **Undo** for any number of entries, including the last score of a finished game.
- **Saved games and history**: a game in progress survives closing the app, and finished games feed a high-score list.
- **Light, Dark and System appearance**.
- **Works offline** through a service worker.

## Run locally

```sh
npm start            # serves on http://localhost:8080
npm test             # scoring-rule tests
```

Any static file host works (GitHub Pages, Netlify, etc.). On iPhone or iPad, open the site in Safari and choose **Share → Add to Home Screen** to install it.
