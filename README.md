# Dockge Card

[![HACS](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://hacs.xyz)

A custom Lovelace card for the [Dockge Home Assistant integration](https://github.com/finder39/ha-dockge). Auto-discovers your Dockge servers, stacks, and containers with real-time status, actions, and update tracking.

![screenshot](https://raw.githubusercontent.com/finder39/dockge-card/main/screenshots/card.png)

## Features

- **Auto-discovery** — no manual entity configuration needed
- **Multi-server support** — shows all connected Dockge agents
- **Stack actions** — start, stop, restart, update, and check for updates via popup
- **Processing indicator** — blue pulsing icon when a stack operation is in progress
- **Update tracking** — shows available image updates per stack and container
- **Custom icons** — override stack icons via card config
- **Dark mode** — uses HA theme variables throughout

## Prerequisites

- [Dockge HA integration](https://github.com/finder39/ha-dockge) v1.7.0+

## Installation

### HACS (Recommended)

1. Open HACS in Home Assistant
2. Go to **Frontend** > three-dot menu > **Custom repositories**
3. Add `https://github.com/finder39/dockge-card` with category **Dashboard**
4. Search for "Dockge Card" and install
5. Add the resource if not auto-added:
   ```yaml
   resources:
     - url: /hacsfiles/dockge-card/dockge-card.js
       type: module
   ```

### Manual

1. Download `dockge-card.js` from the [latest release](https://github.com/finder39/dockge-card/releases)
2. Copy to `/config/www/dockge-card/dockge-card.js`
3. Add the resource:
   ```yaml
   resources:
     - url: /local/dockge-card/dockge-card.js
       type: module
   ```

## Usage

```yaml
type: custom:dockge-card
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `show_header` | boolean | `true` | Show the Docker header with running count |
| `icons` | object | `{}` | Custom stack icons (stack name → MDI icon) |

### Example with custom icons

```yaml
type: custom:dockge-card
icons:
  my-app: mdi:application
  database: mdi:database
```

## Cache Busting

When upgrading, update the `?v=` parameter in your resource URL to force browsers to load the new version:

```yaml
- url: /hacsfiles/dockge-card/dockge-card.js?v=1.6.0
  type: module
```

## License

MIT
