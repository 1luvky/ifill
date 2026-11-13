#!/bin/sh
# Builds ifill.zip for the Chrome Web Store.
#
# Usage:  ./build.sh        (run from anywhere; the zip is written next to this script)
#
# Only the files the extension needs are packed (an allowlist), at the ROOT of
# the zip, so manifest.json sits at the top level as the store requires.
# sample-quiz/, README.md, PRIVACY.md, STORE_LISTING.md, build.sh, .git and
# other dev files are never included.
#
# After zipping, it checks that:
#   - every file the extension references is in the zip,
#   - nothing outside the allowlist slipped in,
#   - the zip contains nothing that looks like a Gemini API key,
#     no email address except the support address in popup.js,
#     and no local file paths.
set -eu

cd "$(dirname "$0")"
OUT="ifill.zip"

FILES="manifest.json
background.js
content.js
llm.js
storage.js
popup.html
popup.js
adapters/generic.js
icons/icon16.png
icons/icon32.png
icons/icon48.png
icons/icon128.png"

fail() { echo "BUILD FAILED: $*" >&2; rm -f "$OUT"; exit 1; }

# 1. Every listed file must exist.
for f in $FILES; do [ -f "$f" ] || fail "missing $f"; done

# 2. Every local file the extension references must be in the list.
#    (manifest icons/scripts/popup, script src, ES module imports, injected content scripts)
refs=$(
  {
    grep -oE '"[A-Za-z0-9_./-]+\.(js|html|png)"' manifest.json
    grep -oE 'src="[^":]+"' popup.html
    grep -ohE "from '\./[^']+'" ./*.js
    grep -E "CONTENT_FILES = \[" background.js | grep -oE "'[^']+'"
  } | sed -E "s/^(src=|from )//; s/[\"']//g; s#^\./##" | sort -u
)
for r in $refs; do
  echo "$FILES" | grep -qxF "$r" || fail "$r is referenced by the extension but not in the build list"
done

# 3. Zip (no macOS extra attributes or .DS_Store, fixed file order).
rm -f "$OUT"
# shellcheck disable=SC2086
zip -q -X "$OUT" $FILES

# 4. Zip contents must match the allowlist exactly.
listed=$(unzip -Z1 "$OUT" | sort)
expected=$(echo "$FILES" | sort)
[ "$listed" = "$expected" ] || fail "zip contents differ from the allowlist"

# 5. No secrets or personal data inside the zip.
#    Gemini keys start with "AIza" followed by 35 characters (checked loosely, 30+).
if unzip -p "$OUT" | LC_ALL=C grep -aqE 'AIza[0-9A-Za-z_-]{30,}'; then
  fail "something that looks like a Gemini API key is inside the zip"
fi
#    The only email address allowed is the support address set in popup.js.
support=$(sed -nE "s/^ *email: '([^']+)'.*/\1/p" popup.js)
[ -n "$support" ] || fail "could not find the support email in popup.js"
others=$(unzip -p "$OUT" | LC_ALL=C grep -aoE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' | sort -u | grep -vxF "$support" || true)
[ -z "$others" ] || fail "unexpected email address inside the zip: $others"
#    No local file paths (macOS, Linux or Windows home folders).
if unzip -p "$OUT" | LC_ALL=C grep -aqE '/Users/|/home/|[A-Za-z]:\\Users\\'; then
  fail "a local file path (/Users/, /home/ or C:\\Users\\) is inside the zip"
fi

version=$(sed -nE 's/.*"version": *"([^"]+)".*/\1/p' manifest.json)
echo "Built $OUT  (iFill $version, $(echo "$FILES" | wc -l | tr -d ' ') files, $(du -k "$OUT" | cut -f1) KB)"
unzip -Z1 "$OUT" | sed 's/^/  /'
