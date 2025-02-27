import { MINUTE, SECOND } from '../constants/time';
import getFetchWithTimeout from '../modules/fetch-with-timeout';
import { getStorageItem, setStorageItem } from './storage-helpers';

const fetchWithCache = async ({
  url,
  fetchOptions = {},
  cacheOptions: { cacheRefreshTime = MINUTE * 6, timeout = SECOND * 30 } = {},
  functionName = '',
}: {
  url: string;
  fetchOptions?: Record<string, any>;
  cacheOptions?: Record<string, any>;
  functionName: string;
}) => {
  if (
    fetchOptions.body ||
    (fetchOptions.method && fetchOptions.method !== 'GET')
  ) {
    throw new Error('fetchWithCache only supports GET requests');
  }
  if (!(fetchOptions.headers instanceof window.Headers)) {
    fetchOptions.headers = new window.Headers(fetchOptions.headers);
  }
  if (
    fetchOptions.headers.has('Content-Type') &&
    fetchOptions.headers.get('Content-Type') !== 'application/json'
  ) {
    throw new Error('fetchWithCache only supports JSON responses');
  }

  const currentTime = Date.now();
  const cacheKey = `cachedFetch:${url}`;
  const { cachedResponse, cachedTime } = (await getStorageItem(cacheKey)) || {};
  if (cachedResponse && currentTime - cachedTime < cacheRefreshTime) {
    return cachedResponse;
  }
  fetchOptions.headers.set('Content-Type', 'application/json');
  const fetchWithTimeout = getFetchWithTimeout(timeout);
  const response = await fetchWithTimeout(url, {
    referrerPolicy: 'no-referrer-when-downgrade',
    body: null,
    method: 'GET',
    mode: 'cors',
    ...fetchOptions,
  });
  if (!response.ok) {
    throw new Error(
      `Fetch with cache failed within function ${functionName} with status'${response.status}': '${response.statusText}'`,
    );
  }
  const responseJson =
    response.status === 204 ? undefined : await response.json();
  const cacheEntry = {
    cachedResponse: responseJson,
    cachedTime: currentTime,
  };

  await setStorageItem(cacheKey, cacheEntry);
  return responseJson;
};

export default fetchWithCache;
