#!/usr/bin/env node

function escapeCommandValue(value) {
  return String(value)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
    .replace(/:/g, '%3A')
    .replace(/,/g, '%2C');
}

export function formatErrorDetails(error) {
  if (!error) {
    return 'Unknown error';
  }

  if (error instanceof Error) {
    if (error.stack && error.stack.trim()) {
      return error.stack.trim();
    }

    if (error.message && error.message.trim()) {
      return error.message.trim();
    }
  }

  return String(error).trim() || 'Unknown error';
}

export function reportGitHubError(title, error) {
  const message = escapeCommandValue(formatErrorDetails(error));
  const safeTitle = escapeCommandValue(title);
  console.error(`::error title=${safeTitle}::${message}`);
}
