#!/usr/bin/env bash
# Usage: ./scripts/resend-magic-link.sh <familyname> [--send]
#   Default: resolve/create token and print the manage URL.
#   --send:  also email the link to the address owner.

set -uo pipefail  # no -e: we handle errors explicitly

FAMILY="${1:-}"
SEND=0
if [[ "${2:-}" == "--send" ]]; then SEND=1; fi

if [[ -z "$FAMILY" ]]; then
  echo "Usage: $0 <familyname> [--send]" >&2
  exit 1
fi

d1() {
  bunx wrangler d1 execute famio --remote --json --command "$1" 2>/dev/null
}

jqr() {
  jq '(if type == "array" then .[0] else . end).results'
}

echo ""
echo "=== Address info for ${FAMILY}@famio.org ==="
ADDRESS_JSON=$(d1 "
  SELECT a.id, a.name, a.owner_email, a.tier, a.active,
         datetime(a.created_at, 'unixepoch') AS created_at,
         COUNT(m.id) AS member_count
  FROM addresses a
  LEFT JOIN members m ON m.address_id = a.id
  WHERE a.name = '${FAMILY}'
  GROUP BY a.id
" | jq '(if type == "array" then .[0] else . end).results[0]')

if [[ -z "$ADDRESS_JSON" || "$ADDRESS_JSON" == "null" ]]; then
  echo "Error: address '${FAMILY}' not found in D1." >&2
  exit 1
fi

echo "$ADDRESS_JSON" | jq .
OWNER_EMAIL=$(echo "$ADDRESS_JSON" | jq -r '.owner_email')
ACTIVE=$(echo "$ADDRESS_JSON" | jq -r '.active')

if [[ "$ACTIVE" != "1" ]]; then
  echo "Warning: address is not active (active=${ACTIVE})." >&2
fi

echo ""
echo "=== Members ==="
d1 "
  SELECT m.email, m.confirmed, datetime(m.added_at, 'unixepoch') AS added_at
  FROM members m
  JOIN addresses a ON a.id = m.address_id
  WHERE a.name = '${FAMILY}'
  ORDER BY m.added_at
" | jqr || echo "(could not fetch members)"

echo ""
echo "=== Recent tokens ==="
d1 "
  SELECT t.token, t.type, t.used, datetime(t.expires_at, 'unixepoch') AS expires_at
  FROM tokens t
  JOIN addresses a ON a.id = t.address_id
  WHERE a.name = '${FAMILY}'
  ORDER BY t.expires_at DESC LIMIT 10
" | jqr || echo "(could not fetch tokens)"

echo ""
echo "=== Resolving magic_link token ==="
TOKEN=$(d1 "
  SELECT t.token FROM tokens t
  JOIN addresses a ON a.id = t.address_id
  WHERE a.name = '${FAMILY}' AND a.active = 1
    AND t.type = 'magic_link' AND t.used = 0
    AND t.expires_at > unixepoch()
  ORDER BY t.expires_at DESC LIMIT 1
" | jq -r '(if type == "array" then .[0] else . end).results[0].token')

if [[ -n "$TOKEN" && "$TOKEN" != "null" ]]; then
  echo "Reusing existing valid token."
else
  echo "No valid token found — expiring old ones and inserting a fresh token..."
  bunx wrangler d1 execute famio --remote --command "
    UPDATE tokens SET used = 1
    WHERE address_id = (SELECT id FROM addresses WHERE name = '${FAMILY}')
      AND type = 'magic_link' AND used = 0
  " 2>&1 | tail -3

  bunx wrangler d1 execute famio --remote --command "
    INSERT INTO tokens (token, address_id, type, expires_at, used)
    SELECT lower(hex(randomblob(16))), id, 'magic_link', unixepoch() + 604800, 0
    FROM addresses WHERE name = '${FAMILY}' AND active = 1
  " 2>&1 | tail -3

  TOKEN=$(d1 "
    SELECT t.token FROM tokens t
    JOIN addresses a ON a.id = t.address_id
    WHERE a.name = '${FAMILY}' AND a.active = 1
      AND t.type = 'magic_link' AND t.used = 0
    ORDER BY t.expires_at DESC LIMIT 1
  " | jq -r '(if type == "array" then .[0] else . end).results[0].token')

  if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
    echo "Error: could not retrieve token after insert." >&2
    exit 1
  fi
fi

echo ""
echo "Manage URL: https://famio.org/manage?token=${TOKEN}"

if [[ $SEND -eq 0 ]]; then
  echo ""
  echo "Run with --send to email this link to ${OWNER_EMAIL}."
  exit 0
fi

echo ""
echo "=== Sending magic link email to ${OWNER_EMAIL} ==="
set +e
BODY=$(curl -s --max-time 30 \
  -X POST \
  -H "Content-Length: 0" \
  -w '\n__HTTP_STATUS__%{http_code}' \
  "https://famio.org/manage/magic-link?token=${TOKEN}")
CURL_EXIT=$?
set -e

if [[ $CURL_EXIT -ne 0 ]]; then
  echo "Error: curl failed (exit ${CURL_EXIT} — exit 28 = timeout)." >&2
  echo "You can use the manage URL above to access the manage page directly."
  exit 1
fi

HTTP_CODE=$(echo "$BODY" | grep '__HTTP_STATUS__' | sed 's/__HTTP_STATUS__//')
RESPONSE=$(echo "$BODY" | grep -v '__HTTP_STATUS__')

echo "HTTP status: ${HTTP_CODE}"
echo "Response body: ${RESPONSE}"

if [[ "$HTTP_CODE" == "200" ]] && echo "$RESPONSE" | jq -e '.ok' > /dev/null 2>&1; then
  echo ""
  echo "Done. Magic link email sent to ${OWNER_EMAIL}."
else
  echo ""
  echo "Worker did not return ok=true. Use the manage URL above directly."
fi
