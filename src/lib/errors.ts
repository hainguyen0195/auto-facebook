export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function assertFound<T>(
  value: T | null | undefined,
  message = "Không tìm thấy dữ liệu.",
): T {
  if (value === null || value === undefined) throw new AppError(404, message);
  return value;
}
