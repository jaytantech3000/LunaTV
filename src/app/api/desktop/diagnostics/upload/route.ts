import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

const GITHUB_API_BASE = 'https://api.github.com';
const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

const DiagnosticsLevelSchema = z.enum(['ok', 'warning', 'error']);

const DiagnosticsFindingSchema = z.object({
  level: DiagnosticsLevelSchema,
  title: z.string(),
  detail: z.string(),
});

const DiagnosticsReportSchema = z.object({
  status: DiagnosticsLevelSchema,
  capturedAtMs: z.number(),
  summary: z.string(),
  findings: z.array(DiagnosticsFindingSchema),
  recommendations: z.array(z.string()),
  logText: z.string(),
});

const DiagnosticsUploadRequestSchema = z.object({
  sourceApp: z.string().optional(),
  appVersion: z.string().optional(),
  targetTriple: z.string().optional(),
  platform: z.string().optional(),
  uploadedAtMs: z.number().optional(),
  report: DiagnosticsReportSchema,
});

type DiagnosticsUploadRequest = z.infer<typeof DiagnosticsUploadRequestSchema>;

interface DiagnosticsUploadResponse {
  uploaded: boolean;
  target: string;
  issueUrl?: string;
  issueNumber?: number;
  message: string;
}

function buildResponse(
  payload: DiagnosticsUploadResponse,
  status = 200
): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

function readEnvValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function isDiagnosticsUploadEnabled(): boolean {
  const value =
    process.env.DESKTOP_DIAGNOSTICS_UPLOAD_ENABLED?.trim().toLowerCase();
  return value ? ENABLED_VALUES.has(value) : false;
}

function getGithubToken(): string | null {
  return (
    readEnvValue('DESKTOP_DIAGNOSTICS_GITHUB_TOKEN') ||
    readEnvValue('GITHUB_TOKEN') ||
    readEnvValue('GH_TOKEN')
  );
}

function getGithubRepository(): string | null {
  return (
    readEnvValue('DESKTOP_DIAGNOSTICS_GITHUB_REPOSITORY') ||
    readEnvValue('GITHUB_REPOSITORY') ||
    readEnvValue('NEXT_PUBLIC_RELEASE_REPOSITORY')
  );
}

function getGithubLabels(): string[] {
  const labels = readEnvValue('DESKTOP_DIAGNOSTICS_GITHUB_LABELS');
  if (!labels) {
    return [];
  }

  return labels
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSingleLine(
  value: string | undefined,
  fallback: string
): string {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized ? normalized : fallback;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n...[truncated ${
    value.length - maxLength
  } chars]`;
}

function escapeCodeFence(value: string): string {
  return value.replace(/```/g, "'''");
}

function formatTimestamp(value: number | undefined): string {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return 'unknown';
  }

  try {
    return new Date(value).toISOString();
  } catch (_) {
    return String(value);
  }
}

function formatFindings(payload: DiagnosticsUploadRequest): string {
  if (!payload.report.findings.length) {
    return '- none';
  }

  return payload.report.findings
    .slice(0, 24)
    .map((finding) => {
      const title = truncateText(
        normalizeSingleLine(finding.title, 'untitled'),
        120
      );
      const detail = truncateText(finding.detail.trim() || '(empty)', 1800);
      return `### [${finding.level.toUpperCase()}] ${title}\n\n${detail}`;
    })
    .join('\n\n');
}

function formatRecommendations(payload: DiagnosticsUploadRequest): string {
  if (!payload.report.recommendations.length) {
    return '- none';
  }

  return payload.report.recommendations
    .slice(0, 24)
    .map((item) => `- ${truncateText(item.trim() || '(empty)', 300)}`)
    .join('\n');
}

function buildIssueTitle(payload: DiagnosticsUploadRequest): string {
  const capturedAt = formatTimestamp(payload.report.capturedAtMs).replace(
    /\.\d{3}Z$/,
    'Z'
  );

  return `Desktop diagnostics | ${payload.report.status} | ${capturedAt}`;
}

function buildIssueBody(
  payload: DiagnosticsUploadRequest,
  request: NextRequest
): string {
  const logText = truncateText(payload.report.logText, 24000);
  const summary = truncateText(
    payload.report.summary.trim() || '(empty)',
    3000
  );
  const userAgent = normalizeSingleLine(
    request.headers.get('user-agent') || undefined,
    'unknown'
  );

  return [
    '## Summary',
    `- Source app: ${normalizeSingleLine(payload.sourceApp, 'lunatv-desktop')}`,
    `- App version: ${normalizeSingleLine(payload.appVersion, 'unknown')}`,
    `- Target triple: ${normalizeSingleLine(payload.targetTriple, 'unknown')}`,
    `- Platform: ${normalizeSingleLine(payload.platform, 'unknown')}`,
    `- Captured at: ${formatTimestamp(payload.report.capturedAtMs)}`,
    `- Uploaded at: ${formatTimestamp(payload.uploadedAtMs)}`,
    `- Relay user-agent: ${userAgent}`,
    '',
    summary,
    '',
    '## Findings',
    formatFindings(payload),
    '',
    '## Recommendations',
    formatRecommendations(payload),
    '',
    '## Raw Log',
    '<details>',
    '<summary>Expand desktop diagnostics log</summary>',
    '',
    '```text',
    escapeCodeFence(logText || '(empty)'),
    '```',
    '',
    '</details>',
  ].join('\n');
}

async function createGithubIssue(
  repository: string,
  token: string,
  payload: DiagnosticsUploadRequest,
  request: NextRequest
): Promise<{ number: number; html_url: string }> {
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${repository}/issues`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'LunaTV-Desktop-Diagnostics-Relay',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        title: buildIssueTitle(payload),
        body: buildIssueBody(payload, request),
        labels: getGithubLabels(),
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `GitHub API error ${response.status}: ${truncateText(
        errorText || response.statusText,
        1000
      )}`
    );
  }

  return response.json();
}

export async function POST(request: NextRequest) {
  if (!isDiagnosticsUploadEnabled()) {
    return buildResponse(
      {
        uploaded: false,
        target: 'github',
        message: '当前站点未启用桌面排查日志自动上传。',
      },
      501
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (_) {
    return buildResponse(
      {
        uploaded: false,
        target: 'github',
        message: '请求体不是有效 JSON。',
      },
      400
    );
  }

  const parsed = DiagnosticsUploadRequestSchema.safeParse(body);
  if (!parsed.success) {
    return buildResponse(
      {
        uploaded: false,
        target: 'github',
        message: '排查日志上传参数无效。',
      },
      400
    );
  }

  const payload = parsed.data;
  if (payload.report.logText.length > 200_000) {
    return buildResponse(
      {
        uploaded: false,
        target: 'github',
        message: '排查日志过大，站点已拒绝自动上传。',
      },
      413
    );
  }

  const token = getGithubToken();
  const repository = getGithubRepository();
  if (!token || !repository) {
    return buildResponse(
      {
        uploaded: false,
        target: 'github',
        message:
          '站点尚未配置 GitHub 诊断上传凭证，请设置 DESKTOP_DIAGNOSTICS_GITHUB_TOKEN 和 DESKTOP_DIAGNOSTICS_GITHUB_REPOSITORY。',
      },
      501
    );
  }

  try {
    const issue = await createGithubIssue(repository, token, payload, request);
    return buildResponse({
      uploaded: true,
      target: 'github',
      issueUrl: issue.html_url,
      issueNumber: issue.number,
      message: `已自动上传到 GitHub issue #${issue.number}。`,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('desktop diagnostics upload relay failed:', error);
    return buildResponse(
      {
        uploaded: false,
        target: 'github',
        message: `自动上传到 GitHub 失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      502
    );
  }
}
