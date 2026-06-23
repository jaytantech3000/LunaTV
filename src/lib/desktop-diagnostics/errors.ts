export class DesktopDiagnosticsError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = 'DesktopDiagnosticsError';
    this.code = code;
    this.status = status;
  }
}
