# Themes

Add a `*.json` file in this directory to add a theme. The app scans this
directory at startup through `/api/themes`.

Required fields:

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "order": 40,
  "css": {
    "--bg": "#1f1f1f",
    "--bg-sidebar": "#2b2b2b",
    "--bg-panel": "#1f1f1f",
    "--bg-hover": "#3a3a3a",
    "--bg-secondary": "#262626",
    "--bg-primary": "#1f1f1f",
    "--border": "#4a4a4a",
    "--text": "#dddddd",
    "--text-dim": "#888888",
    "--accent": "#6aa6ff",
    "--green": "#7fbf5f",
    "--red": "#ff6b6b",
    "--yellow": "#ffd166",
    "--cyan": "#66c2d6",
    "--magenta": "#b48ead"
  },
  "terminal": {
    "background": "#1f1f1f",
    "foreground": "#dddddd",
    "cursor": "#dddddd",
    "selectionBackground": "#264f78"
  },
  "monaco": {
    "base": "vs-dark",
    "inherit": true,
    "rules": [],
    "colors": {
      "editor.background": "#1f1f1f",
      "editor.foreground": "#dddddd"
    }
  }
}
```

`id` may contain lowercase letters, numbers, dashes, and underscores.
