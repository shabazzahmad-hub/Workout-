# Vendored skill

`SKILL.md` is a verbatim copy of `skills/i-have-adhd/SKILL.md` from
<https://github.com/ayghri/i-have-adhd> (MIT, © Ayoub G. — see `LICENSE`).

It is checked in rather than installed as a plugin because Claude Code on the
web runs each session in a fresh container: a `claude plugin install` writes to
`~/.claude/settings.json` inside that container and is gone the moment the
session ends. A skill under `.claude/skills/` travels with the repository, so
it loads in web sessions, local sessions and any clone.

Invoke with `/i-have-adhd`. It stays on for the rest of the session until you
say "stop adhd mode". `disable-model-invocation: true` means it never activates
on its own — only when you ask for it.

To take an upstream update, re-copy `skills/i-have-adhd/SKILL.md` from the
source repository over this directory's copy.
