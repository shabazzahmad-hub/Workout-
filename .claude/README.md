# Claude Code settings

These files are Claude Code configuration. They are not part of the app.
Nothing here ships to the PWA.

| File | What it does |
|---|---|
| `settings.json` | Turns on the `ELI5` output style for this repo |
| `output-styles/eli5.md` | The style itself |

## The ELI5 style

It asks for plain words, bullet points, and very short paragraphs. It
also follows ASD-STE100 Simplified Technical English, Issue 8.

Code, file paths, error messages and tool output are never rewritten.
Only the explanation around them is simplified.

## To use it everywhere, not only in this repo

Copy the style to your home folder:

```
mkdir -p ~/.claude/output-styles
cp .claude/output-styles/eli5.md ~/.claude/output-styles/
```

Then turn it on:

```
/config outputStyle=ELI5
```

## To turn it off

```
/config outputStyle=default
```

## A note on skills

The `lean-mode` skill asks for very short output. It pulls against this
style, which asks for fuller explanation. The two fight each other.

`lean-mode` syncs from your claude.ai account. Turning it off on disk
does not last. Disable it in your claude.ai settings instead.
