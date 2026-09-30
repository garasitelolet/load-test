import { check, sleep } from 'k6';
import { getHealth } from './helpers.js';

const targetVus = Number(__ENV.TARGET_VUS || 20);
const rampUp = __ENV.RAMP_UP || '1m';
const hold = __ENV.HOLD || '3m';
const rampDown = __ENV.RAMP_DOWN || '1m';

export const options = {
  stages: [
    { duration: rampUp, target: targetVus },
    { duration: hold, target: targetVus },
    { duration: rampDown, target: 0 }
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    checks: ['rate>0.99']
  }
};

export default function () {
  const response = getHealth();

  check(response, {
    'response status is 2xx': (result) => result.status >= 200 && result.status < 300,
    'response has a body': (result) => Boolean(result.body)
  });

  sleep(Number(__ENV.THINK_TIME || 1));
}
