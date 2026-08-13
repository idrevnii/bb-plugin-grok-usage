# Grok Usage

Tiny [BB](https://getbb.app) plugin: Grok Build weekly limit on **Settings → Usage limits**.

BB's built-in usage page only covers Codex, Claude Code, and Cursor. This plugin reads the `grok login` session in `~/.grok/auth.json` and injects a Grok Build row into that card.

No extra API key. Grok Build is a SuperGrok-and-up feature.

## Install

```sh
bb plugin install https://github.com/idrevnii/bb-plugin-grok-usage
```

Or from a local checkout:

```sh
bb plugin install .
```

## CLI

```sh
bb grok-usage show
bb grok-usage show --json
```
