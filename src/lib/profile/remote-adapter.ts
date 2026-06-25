import {
  type ProfileRequestInit,
  fetchProfileJson,
  fetchProfileResponse,
  isUnauthorizedProfileRequestError,
  wasProfileRequestRedirectedToLogin,
} from './session';

export type RemoteProfileSearchParamValue =
  | string
  | number
  | boolean
  | null
  | undefined;

export type RemoteProfileSearchParams = Record<
  string,
  RemoteProfileSearchParamValue
>;

export function buildRemoteProfilePath(
  path: string,
  searchParams?: RemoteProfileSearchParams | URLSearchParams
): string {
  const nextSearchParams = new URLSearchParams();

  if (searchParams instanceof URLSearchParams) {
    searchParams.forEach((value, key) => {
      if (value) {
        nextSearchParams.set(key, value);
      }
    });
  } else if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') {
        return;
      }

      nextSearchParams.set(key, String(value));
    });
  }

  const queryString = nextSearchParams.toString();
  if (!queryString) {
    return path;
  }

  return `${path}${path.includes('?') ? '&' : '?'}${queryString}`;
}

export function fetchRemoteProfileResponse(
  path: string,
  options?: ProfileRequestInit
): Promise<Response> {
  return fetchProfileResponse(path, options);
}

export function fetchRemoteProfileJson<T>(
  path: string,
  options?: ProfileRequestInit
): Promise<T> {
  return fetchProfileJson<T>(path, options);
}

export function postRemoteProfilePayload(
  path: string,
  payload: Record<string, unknown>,
  options?: ProfileRequestInit
): Promise<Response> {
  return fetchProfileResponse(path, {
    ...options,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function deleteRemoteProfileResource(
  path: string,
  searchParams?: RemoteProfileSearchParams | URLSearchParams,
  options?: ProfileRequestInit
): Promise<Response> {
  return fetchProfileResponse(buildRemoteProfilePath(path, searchParams), {
    ...options,
    method: 'DELETE',
  });
}

export {
  isUnauthorizedProfileRequestError as isUnauthorizedRemoteProfileRequestError,
  wasProfileRequestRedirectedToLogin as wasRemoteProfileRequestRedirectedToLogin,
};
export type { ProfileRequestInit as RemoteProfileRequestInit };
