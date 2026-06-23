'use client';

import { useEffect, useState } from 'react';

import {
  type DesktopDiagnosticsListItem,
  type DesktopDiagnosticsReportRow,
  type DesktopDiagnosticsStatus,
  DESKTOP_DIAGNOSTICS_STATUSES,
} from '@/lib/desktop-diagnostics/types';

const STATUS_LABELS: Record<DesktopDiagnosticsStatus, string> = {
  forwarded: '已转发',
  ignored: '已忽略',
  new: '新建',
  resolved: '已解决',
  triaged: '已分诊',
};

const STATUS_TRANSITIONS: Record<
  DesktopDiagnosticsStatus,
  DesktopDiagnosticsStatus[]
> = {
  forwarded: [],
  ignored: ['triaged'],
  new: ['triaged', 'ignored'],
  resolved: ['triaged'],
  triaged: ['resolved', 'ignored'],
};

interface DiagnosticsListResponse {
  items: DesktopDiagnosticsListItem[];
  ok: true;
  page: number;
  pageSize: number;
  total: number;
}

interface DiagnosticsDetailResponse {
  ok: true;
  report: DesktopDiagnosticsReportRow;
}

interface DiagnosticsStatusResponse {
  ok: true;
  report: DesktopDiagnosticsReportRow;
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return '-';
  }

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function getStatusOptions(
  status: DesktopDiagnosticsStatus | null
): DesktopDiagnosticsStatus[] {
  if (!status) {
    return ['new'];
  }

  return [status, ...STATUS_TRANSITIONS[status]].filter(
    (value, index, array) => array.indexOf(value) === index
  );
}

async function parseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: string;
      message?: string;
    };
    return payload.message || payload.error || `请求失败: ${response.status}`;
  } catch {
    return `请求失败: ${response.status}`;
  }
}

export default function DesktopDiagnosticsAdminPanel() {
  const [items, setItems] = useState<DesktopDiagnosticsListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] =
    useState<DesktopDiagnosticsReportRow | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [draftStatus, setDraftStatus] =
    useState<DesktopDiagnosticsStatus | null>(null);
  const [draftNotes, setDraftNotes] = useState('');
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const selectedStatusOptions = getStatusOptions(
    draftStatus || selectedReport?.status || null
  );

  const fetchReport = async (reportId: string) => {
    setDetailLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/diagnostics/${reportId}`, {
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(await parseError(response));
      }

      const payload = (await response.json()) as DiagnosticsDetailResponse;
      setSelectedId(reportId);
      setSelectedReport(payload.report);
      setDraftNotes(payload.report.operator_notes || '');
      setDraftStatus(payload.report.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载诊断详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const fetchList = async (preferredId?: string | null) => {
    setListLoading(true);
    setError(null);

    try {
      const searchParams = new URLSearchParams({
        page: '1',
        pageSize: '20',
      });

      if (statusFilter !== 'all') {
        searchParams.set('status', statusFilter);
      }

      const response = await fetch(`/api/admin/diagnostics?${searchParams}`, {
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(await parseError(response));
      }

      const payload = (await response.json()) as DiagnosticsListResponse;
      setItems(payload.items);
      setTotal(payload.total);

      const nextId =
        preferredId && payload.items.some((item) => item.id === preferredId)
          ? preferredId
          : payload.items[0]?.id || null;

      if (!nextId) {
        setSelectedId(null);
        setSelectedReport(null);
        setDraftNotes('');
        setDraftStatus(null);
        return;
      }

      if (nextId !== selectedId || !selectedReport) {
        await fetchReport(nextId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载诊断列表失败');
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    void fetchList(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const handleRefresh = async () => {
    await fetchList(selectedId);
  };

  const handleCopyReportId = async () => {
    if (!selectedReport?.id || !navigator.clipboard) {
      return;
    }

    try {
      setCopying(true);
      await navigator.clipboard.writeText(selectedReport.id);
    } finally {
      setTimeout(() => setCopying(false), 1200);
    }
  };

  const handleSave = async () => {
    if (!selectedId || !draftStatus) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/admin/diagnostics/${selectedId}/status`,
        {
          body: JSON.stringify({
            operatorNotes: draftNotes,
            status: draftStatus,
          }),
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
        }
      );

      if (!response.ok) {
        throw new Error(await parseError(response));
      }

      const payload = (await response.json()) as DiagnosticsStatusResponse;
      setSelectedReport(payload.report);
      setDraftNotes(payload.report.operator_notes || '');
      setDraftStatus(payload.report.status);
      await fetchList(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新诊断状态失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900'>
        <div className='space-y-1'>
          <div className='text-sm font-medium text-gray-900 dark:text-gray-100'>
            诊断报告总数：{total}
          </div>
          <div className='text-xs text-gray-500 dark:text-gray-400'>
            支持查看报告详情、下载脱敏日志，并更新分诊状态。
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className='rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
          >
            <option value='all'>全部状态</option>
            {DESKTOP_DIAGNOSTICS_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
          <button
            onClick={() => void handleRefresh()}
            disabled={listLoading || detailLoading}
            className='rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400'
          >
            {listLoading ? '刷新中...' : '刷新'}
          </button>
        </div>
      </div>

      {error && (
        <div className='rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300'>
          {error}
        </div>
      )}

      <div className='grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]'>
        <div className='overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900'>
          <div className='border-b border-gray-200 px-4 py-3 text-sm font-medium text-gray-900 dark:border-gray-700 dark:text-gray-100'>
            最新报告
          </div>

          {items.length === 0 ? (
            <div className='px-4 py-8 text-sm text-gray-500 dark:text-gray-400'>
              暂无诊断报告。
            </div>
          ) : (
            <div className='max-h-[680px] overflow-y-auto'>
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => void fetchReport(item.id)}
                  className={`w-full border-b border-gray-100 px-4 py-3 text-left transition-colors last:border-b-0 dark:border-gray-800 ${
                    selectedId === item.id
                      ? 'bg-blue-50 dark:bg-blue-950/40'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
                  }`}
                >
                  <div className='flex items-start justify-between gap-3'>
                    <div className='min-w-0 space-y-1'>
                      <div className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
                        {item.summary}
                      </div>
                      <div className='text-xs text-gray-500 dark:text-gray-400'>
                        {item.platform} · {item.channel} ·{' '}
                        {formatTimestamp(item.created_at)}
                      </div>
                    </div>
                    <span className='shrink-0 rounded-full bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300'>
                      {STATUS_LABELS[item.status]}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className='rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900'>
          {detailLoading ? (
            <div className='py-10 text-sm text-gray-500 dark:text-gray-400'>
              正在加载详情...
            </div>
          ) : !selectedReport ? (
            <div className='py-10 text-sm text-gray-500 dark:text-gray-400'>
              选择左侧报告查看详情。
            </div>
          ) : (
            <div className='space-y-5'>
              <div className='flex flex-wrap items-start justify-between gap-3'>
                <div className='space-y-2'>
                  <div className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    {selectedReport.summary}
                  </div>
                  <div className='flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400'>
                    <span>Report ID: {selectedReport.id}</span>
                    <button
                      onClick={() => void handleCopyReportId()}
                      className='rounded-full bg-gray-100 px-2 py-1 font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                    >
                      {copying ? '已复制' : '复制 ID'}
                    </button>
                  </div>
                </div>

                <div className='flex flex-wrap items-center gap-2'>
                  <span className='rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'>
                    {STATUS_LABELS[selectedReport.status]}
                  </span>
                  <a
                    href={`/api/admin/diagnostics/${selectedReport.id}/download`}
                    className='rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200'
                  >
                    下载日志
                  </a>
                </div>
              </div>

              <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
                <div className='rounded-lg bg-gray-50 px-3 py-3 dark:bg-gray-800/70'>
                  <div className='text-xs text-gray-500 dark:text-gray-400'>
                    平台
                  </div>
                  <div className='mt-1 text-sm font-medium text-gray-900 dark:text-gray-100'>
                    {selectedReport.platform}
                  </div>
                </div>
                <div className='rounded-lg bg-gray-50 px-3 py-3 dark:bg-gray-800/70'>
                  <div className='text-xs text-gray-500 dark:text-gray-400'>
                    渠道
                  </div>
                  <div className='mt-1 text-sm font-medium text-gray-900 dark:text-gray-100'>
                    {selectedReport.channel}
                  </div>
                </div>
                <div className='rounded-lg bg-gray-50 px-3 py-3 dark:bg-gray-800/70'>
                  <div className='text-xs text-gray-500 dark:text-gray-400'>
                    上传时间
                  </div>
                  <div className='mt-1 text-sm font-medium text-gray-900 dark:text-gray-100'>
                    {formatTimestamp(selectedReport.created_at)}
                  </div>
                </div>
                <div className='rounded-lg bg-gray-50 px-3 py-3 dark:bg-gray-800/70'>
                  <div className='text-xs text-gray-500 dark:text-gray-400'>
                    App 版本
                  </div>
                  <div className='mt-1 break-all text-sm font-medium text-gray-900 dark:text-gray-100'>
                    {selectedReport.app_version || '-'}
                  </div>
                </div>
                <div className='rounded-lg bg-gray-50 px-3 py-3 dark:bg-gray-800/70'>
                  <div className='text-xs text-gray-500 dark:text-gray-400'>
                    本地服务版本
                  </div>
                  <div className='mt-1 break-all text-sm font-medium text-gray-900 dark:text-gray-100'>
                    {selectedReport.local_service_version || '-'}
                  </div>
                </div>
                <div className='rounded-lg bg-gray-50 px-3 py-3 dark:bg-gray-800/70'>
                  <div className='text-xs text-gray-500 dark:text-gray-400'>
                    指纹 / SHA256
                  </div>
                  <div className='mt-1 break-all text-sm font-medium text-gray-900 dark:text-gray-100'>
                    {selectedReport.error_fingerprint || '-'}
                    <div className='mt-1 text-xs font-normal text-gray-500 dark:text-gray-400'>
                      {selectedReport.raw_log_sha256}
                    </div>
                  </div>
                </div>
              </div>

              <div className='grid gap-4 xl:grid-cols-2'>
                <div>
                  <div className='mb-2 text-sm font-medium text-gray-900 dark:text-gray-100'>
                    Findings
                  </div>
                  <div className='rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-200'>
                    {selectedReport.findings.length > 0 ? (
                      <div className='space-y-2'>
                        {selectedReport.findings.map((item, index) => (
                          <div key={`${selectedReport.id}-finding-${index}`}>
                            {item}
                          </div>
                        ))}
                      </div>
                    ) : (
                      '无'
                    )}
                  </div>
                </div>

                <div>
                  <div className='mb-2 text-sm font-medium text-gray-900 dark:text-gray-100'>
                    Recommendations
                  </div>
                  <div className='rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-200'>
                    {selectedReport.recommendations.length > 0 ? (
                      <div className='space-y-2'>
                        {selectedReport.recommendations.map((item, index) => (
                          <div
                            key={`${selectedReport.id}-recommendation-${index}`}
                          >
                            {item}
                          </div>
                        ))}
                      </div>
                    ) : (
                      '无'
                    )}
                  </div>
                </div>
              </div>

              <div>
                <div className='mb-2 text-sm font-medium text-gray-900 dark:text-gray-100'>
                  脱敏日志摘录
                </div>
                <pre className='max-h-64 overflow-auto rounded-lg border border-gray-200 bg-gray-950 px-3 py-3 text-xs leading-6 text-green-200 dark:border-gray-700'>
                  {selectedReport.raw_log_excerpt || '无'}
                </pre>
              </div>

              <div>
                <div className='mb-2 text-sm font-medium text-gray-900 dark:text-gray-100'>
                  Report Payload
                </div>
                <pre className='max-h-64 overflow-auto rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-xs leading-6 text-gray-700 dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-200'>
                  {JSON.stringify(selectedReport.report_payload, null, 2)}
                </pre>
              </div>

              <div className='grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]'>
                <div>
                  <label className='mb-2 block text-sm font-medium text-gray-900 dark:text-gray-100'>
                    状态
                  </label>
                  <select
                    value={draftStatus || selectedReport.status}
                    onChange={(event) =>
                      setDraftStatus(
                        event.target.value as DesktopDiagnosticsStatus
                      )
                    }
                    className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                  >
                    {selectedStatusOptions.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className='mb-2 block text-sm font-medium text-gray-900 dark:text-gray-100'>
                    Operator Notes
                  </label>
                  <textarea
                    value={draftNotes}
                    onChange={(event) => setDraftNotes(event.target.value)}
                    rows={5}
                    className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                    placeholder='补充分诊结论、复现结论或处理建议。'
                  />
                </div>
              </div>

              <div className='flex flex-wrap justify-end gap-2'>
                <button
                  onClick={() => void handleRefresh()}
                  className='rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800'
                >
                  重新拉取
                </button>
                <button
                  onClick={() => void handleSave()}
                  disabled={saving || !draftStatus}
                  className='rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-400'
                >
                  {saving ? '保存中...' : '保存状态'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
