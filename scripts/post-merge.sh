#!/usr/bin/env bash
set -euo pipefail

export npm_config_yes=true
npm install --no-audit --no-fund
