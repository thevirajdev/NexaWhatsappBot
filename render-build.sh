#!/usr/bin/env bash
# exit on error
set -o errexit

npm install

# Force install chrome in the project's own directory for Render persistence
PUPPETEER_CACHE_DIR=/opt/render/project/src/.cache/puppeteer npx puppeteer browsers install chrome
