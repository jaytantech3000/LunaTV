#!/usr/bin/env node

const WORKFLOW_URL =
  'https://github.com/jaytantech3000/LunaTV/actions/workflows/desktop-build.yml';
const RUN_URL_PREFIX = 'https://github.com/jaytantech3000/LunaTV/actions/runs/';
const POLL_INTERVAL_MS = 15000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'LunaTV desktop windows build monitor',
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }

  return response.text();
}

function decodeHtml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'");
}

function parseLatestRun(html) {
  const regex =
    /href="\/jaytantech3000\/LunaTV\/actions\/runs\/(\d+)"[^>]*aria-label="([^"]+)"/g;

  for (const match of html.matchAll(regex)) {
    const runId = match[1];
    const label = decodeHtml(match[2]);
    if (!label.includes('Build Desktop App')) {
      continue;
    }

    const status = label.split(':', 1)[0].trim();
    return {
      runId,
      label,
      status,
    };
  }

  return null;
}

function parseJobStatus(html, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `href="\\/jaytantech3000\\/LunaTV\\/actions\\/runs\\/\\d+\\/job\\/(\\d+)(?:#step:[^"]*)?"[^>]*>\\s*<strong>${escapedName}<\\/strong>`,
    'g'
  );

  const match = regex.exec(html);
  if (!match) {
    return null;
  }

  const jobId = match[1];
  const windowStart = Math.max(0, match.index - 400);
  const windowEnd = Math.min(html.length, match.index + 1200);
  const snippet = html.slice(windowStart, windowEnd);

  let status = 'unknown';
  if (snippet.includes('octicon-check-circle-fill')) {
    status = 'success';
  } else if (snippet.includes('octicon-x-circle-fill')) {
    status = 'failure';
  } else if (snippet.includes('octicon-dot-fill')) {
    status = 'in_progress';
  } else if (snippet.includes('octicon-skip')) {
    status = 'skipped';
  }

  const messageMatch = snippet.match(
    /annotation--contracted">\s*<div>([\s\S]*?)<\/div>/
  );

  return {
    jobId,
    status,
    message: messageMatch ? decodeHtml(messageMatch[1]).replace(/<[^>]+>/g, '') : '',
  };
}

function parseJobAnnotations(html) {
  const rows = [];
  const regex =
    /href="#annotation:[^"]+">\s*<strong>([\s\S]*?)<\/strong>[\s\S]*?annotation--contracted">\s*<div>([\s\S]*?)<\/div>/g;

  for (const match of html.matchAll(regex)) {
    rows.push({
      step: decodeHtml(match[1]).replace(/<[^>]+>/g, '').trim(),
      message: decodeHtml(match[2]).replace(/<[^>]+>/g, '').trim(),
    });
  }

  return rows;
}

function formatStatusLine(parts) {
  return `[monitor] ${parts.filter(Boolean).join(' | ')}`;
}

async function readCurrentState() {
  const workflowHtml = await fetchText(WORKFLOW_URL);
  const latestRun = parseLatestRun(workflowHtml);
  if (!latestRun) {
    throw new Error('Unable to find latest desktop workflow run');
  }

  const runHtml = await fetchText(`${RUN_URL_PREFIX}${latestRun.runId}`);
  const windows = parseJobStatus(runHtml, 'Windows x64');
  const mac = parseJobStatus(runHtml, 'macOS Apple Silicon');

  let windowsAnnotations = [];
  if (windows?.jobId) {
    const windowsJobHtml = await fetchText(
      `${RUN_URL_PREFIX}${latestRun.runId}/job/${windows.jobId}`
    );
    windowsAnnotations = parseJobAnnotations(windowsJobHtml);
  }

  return {
    latestRun,
    windows,
    mac,
    windowsAnnotations,
  };
}

async function main() {
  let previousSignature = '';

  while (true) {
    try {
      const state = await readCurrentState();
      const topAnnotation = state.windowsAnnotations[0];
      const signature = JSON.stringify({
        runId: state.latestRun.runId,
        runStatus: state.latestRun.status,
        windowsStatus: state.windows?.status,
        windowsMessage: state.windows?.message,
        macStatus: state.mac?.status,
        topAnnotation,
      });

      if (signature !== previousSignature) {
        previousSignature = signature;
        console.log(
          formatStatusLine([
            `run=${state.latestRun.runId}`,
            `workflow=${state.latestRun.status}`,
            `windows=${state.windows?.status || 'missing'}`,
            state.windows?.message || '',
            `mac=${state.mac?.status || 'missing'}`,
          ])
        );

        if (topAnnotation) {
          console.log(
            formatStatusLine([
              `windows-step=${topAnnotation.step}`,
              topAnnotation.message,
            ])
          );
        }
      }

      if (state.windows?.status === 'success') {
        console.log(formatStatusLine(['Windows desktop build succeeded']));
        return;
      }
    } catch (error) {
      console.error(formatStatusLine([`error=${error.message}`]));
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch(error => {
  console.error(formatStatusLine([`fatal=${error.message}`]));
  process.exit(1);
});
