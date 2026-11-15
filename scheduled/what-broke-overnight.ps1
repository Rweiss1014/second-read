# The daily "what broke overnight" check. Read-only.
# 1. The script lists posts that failed in the last 24 hours and explains each one in plain words (desk/MORNING.md).
# 2. Optional: a headless Claude Code run reads that note and the known-failures list, and drafts the first
#    reply for each failure as a ticket for a person to send. It may only read files and run the desk itself.
#
# This file is a definition. Nothing registers it for you. To schedule it on Windows, see what-broke-overnight.xml.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

node bin/support-desk.mjs morning
if ($LASTEXITCODE -ne 0) { Write-Output 'The morning check could not read the post list. See: node bin/support-desk.mjs logs'; exit 1 }

if ($env:SUPPORT_DESK_DRAFT_WITH_CLAUDE -eq '1') {
  claude -p "Read desk/MORNING.md and desk/known-failures.md. For each failed post in the note, run: node bin/support-desk.mjs ticket ""<the exact error text>"" --save-reply. Then write desk/MORNING-DRAFTS.md listing each ticket, its desk status, and the packet path for the fresh checker. Do not send anything, and do not call any Blotato tool that creates, changes or deletes." `
    --allowedTools "Read" "Write(desk/MORNING-DRAFTS.md)" "Bash(node bin/support-desk.mjs ticket:*)"
}
