// Browser-side API helper: adds the access code to every request and reports
// a rejected code so the app can return to the access screen.

const KEY = "mockinterview.access";
const listeners = new Set<() => void>();

/** The access code for this tab (sessionStorage: forgotten when the tab closes). */
export function getAccessCode(): string {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setAccessCode(code: string) {
  try {
    if (code) sessionStorage.setItem(KEY, code);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the code lasts until reload */
    memoryCode = code;
  }
  listeners.forEach((l) => l());
}

let memoryCode = "";
export function hasAccessCode(): boolean {
  return getAccessCode() !== "" || memoryCode !== "";
}

export function subscribeAccess(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Error from an API route, with its HTTP status and machine-readable code. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-access-code", getAccessCode() || memoryCode);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) {
    const data = await res
      .clone()
      .json()
      .catch(() => null);
    if (data?.code === "access") setAccessCode(""); // back to the access screen
  }
  return res;
}

/** Throws an ApiError built from a failed response's JSON body. */
export async function throwApiError(res: Response, fallback: string): Promise<never> {
  const data = await res.json().catch(() => null);
  throw new ApiError(data?.error ?? fallback, res.status, data?.code);
}
