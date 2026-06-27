#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_TOKEN:?Missing GITHUB_TOKEN}"
: "${GITHUB_REPOSITORY:?Missing GITHUB_REPOSITORY}"

source_dir="${DOWNLOAD_SITE_SOURCE_DIR:-download-site-dist}"
target_branch="${DOWNLOAD_SITE_BRANCH:-gh-pages}"
commit_message="${DOWNLOAD_SITE_COMMIT_MESSAGE:-chore(download-site): publish site}"

if [ ! -d "$source_dir" ]; then
  echo "Download site source directory not found: $source_dir" >&2
  exit 1
fi

source_dir_abs="$(cd "$source_dir" && pwd)"
repo_url="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
work_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$work_dir"
}

trap cleanup EXIT

git init "$work_dir" >/dev/null 2>&1
cd "$work_dir"
git remote add origin "$repo_url"

if git ls-remote --exit-code --heads origin "$target_branch" >/dev/null 2>&1; then
  git fetch --depth 1 origin "$target_branch"
  git checkout -b "$target_branch" FETCH_HEAD
else
  git checkout --orphan "$target_branch"
fi

find . -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
cp -R "$source_dir_abs"/. .
touch .nojekyll

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add --all

if git diff --cached --quiet; then
  echo "No download site changes to publish"
  exit 0
fi

git commit -m "$commit_message"
git push origin "$target_branch"
