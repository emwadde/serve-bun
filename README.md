# serve-bun

A single-file static file server for [Bun](https://bun.sh) with a clean listing UI. Like `serve`, but with sortable columns (name, size, created, modified), a filter box, inline viewing for images/PDFs, and optional Basic auth.

## Run

```bash
bun serve-bun.ts [dir] [options]
```

## Build a binary

```bash
bun build --compile ./serve-bun.ts --outfile serve-bun
./serve-bun --help
```

Optional: put it on your PATH, e.g. `sudo mv serve-bun /usr/local/bin/`.

## Options

| Option | Description | Default |
|---|---|---|
| `[dir]` | Directory to serve | current directory |
| `--port <n>` | Port to listen on | `3000` |
| `--host <addr>` | Address to bind | `0.0.0.0` |
| `--username <user>` | Basic auth username | off |
| `--password <pass>` | Basic auth password | off |
| `--all` | Show dotfiles | off |
| `-h`, `--help` | Show help | |

`--username` and `--password` must be used together.

## Examples

```bash
serve-bun                                   # serve current dir on :3000
serve-bun ~/Downloads --port 8080           # serve a folder on :8080
serve-bun . --username me --password secret # require login
```

## Notes

- Clicking a file opens it in the browser when possible (images, PDFs, video, text); otherwise it downloads. The ⬇ button always downloads.
- Every request is logged: `time ip method path status duration size`.
- Basic auth is sent in clear text over HTTP. Use a TLS proxy if exposing beyond your LAN.
- Symlinks inside the served folder are followed, even if they point outside it.
