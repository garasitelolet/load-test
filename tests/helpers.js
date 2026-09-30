import http from 'k6/http';

export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
export const HEALTH_PATH = __ENV.HEALTH_PATH || '/';
export const REQUEST_TIMEOUT = __ENV.REQUEST_TIMEOUT || '10s';

export function url(path) {
  return `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export function getHealth() {
  return http.get(url(HEALTH_PATH), {
    headers: {
      Accept: 'application/json'
    },
    timeout: REQUEST_TIMEOUT,
    tags: {
      endpoint: HEALTH_PATH
    }
  });
}
