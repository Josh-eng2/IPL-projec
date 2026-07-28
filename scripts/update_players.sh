#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
node scripts/validate_players.js
node scripts/inline_players.js
