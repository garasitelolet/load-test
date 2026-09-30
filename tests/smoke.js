import { check, sleep } from 'k6';
import { getHealth } from './helpers.js';

export const options = {
  vus: Number(__ENV.VUS || 1),
  duration: __ENV.DURATION || '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000']
  }
};

export default function () {
  const response = getHealth();

  check(response, {
    'response status is 2xx': (result) => result.status >= 200 && result.status < 300,
    'response has a body': (result) => Boolean(result.body)
  });

  sleep(1);
}
