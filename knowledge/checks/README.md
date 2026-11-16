# Saved checks

Each file here is one pass from a fresh checker, for one exact reply text.

The file name is the sha256 of the reply text, and the file says so again inside (`replySha256`).
If one character of a reply changes, its hash changes, and the old pass no longer applies. The reply has to be checked again.

## What a file holds

- `replySha256`: the hash of the reply text that was checked.
- `verdict`: always `pass`. A block is never saved here. It goes back to the entry to be fixed.
- `findings`: the checker's notes. A pass can still carry small style notes.
- `checkedAt`: the date and time the checker read the text.
- `checker` and `model`: who checked, as the checker gave them. `model` is left out when the checker did not say.
- `entry`: the id of the playbook entry the reply came from.

Nothing else. No customer message, no account data, no reply text.

## How the desk uses them

When the desk writes a reply, it looks for a pass for that exact text here first, then in `desk/reviews/`.
A match marks the reply "checked" and shows the date it was checked. That works for a typed message too, as long as the desk produces text a checker already passed.

## How they are made

```bash
node bin/support-desk.mjs packets --all --mock --out <dir>   # one packet per distinct reply text, plus <dir>/index.json
# a fresh reply-checker reads each packet and writes <dir>/<sha256>.verdict.json
node bin/support-desk.mjs record-check --dir <dir>           # passes are saved here, blocks print the entry and the notes
```

`record-check` refuses a verdict whose hash matches no packet in the index, so a pass can never be saved for text nobody packed.
Texts that already have a file here are skipped by `packets --all`.
