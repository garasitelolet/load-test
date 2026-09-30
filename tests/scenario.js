import http from 'k6/http';
import { check, sleep } from 'k6';

const testType = __ENV.TEST_TYPE || 'load';
const targetVus = Number(__ENV.TARGET_VUS || 20);
const breakpointVus = Number(__ENV.BREAKPOINT_VUS || 200);
const duration = __ENV.DURATION || '30s';
const rampUp = __ENV.RAMP_UP || '1m';
const hold = __ENV.HOLD || '3m';
const rampDown = __ENV.RAMP_DOWN || '1m';
const baseUrl = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const path = __ENV.HEALTH_PATH || '/';
const method = (__ENV.REQUEST_METHOD || 'GET').toUpperCase();
const dataSize = Number(__ENV.DATA_SIZE || 1000);

function stagesFor(type) {
  switch (type) {
    case 'stress':
      return [
        { duration: rampUp, target: targetVus },
        { duration: hold, target: targetVus * 2 },
        { duration: rampDown, target: 0 }
      ];
    case 'spike':
      return [
        { duration: '10s', target: Math.max(1, Math.floor(targetVus / 10)) },
        { duration: '10s', target: targetVus },
        { duration: hold, target: targetVus },
        { duration: '10s', target: 0 }
      ];
    case 'soak':
      return [
        { duration: rampUp, target: targetVus },
        { duration: __ENV.SOAK_HOLD || '30m', target: targetVus },
        { duration: rampDown, target: 0 }
      ];
    case 'volume':
      return [
        { duration: rampUp, target: targetVus },
        { duration: hold, target: targetVus },
        { duration: rampDown, target: 0 }
      ];
    case 'scalability':
      return [
        { duration: rampUp, target: Math.max(1, Math.floor(targetVus / 2)) },
        { duration: hold, target: Math.max(1, Math.floor(targetVus / 2)) },
        { duration: rampUp, target: targetVus },
        { duration: hold, target: targetVus },
        { duration: rampDown, target: 0 }
      ];
    case 'capacity':
    case 'breakpoint':
      return [
        { duration: rampUp, target: targetVus },
        { duration: hold, target: targetVus },
        { duration: rampUp, target: breakpointVus },
        { duration: hold, target: breakpointVus },
        { duration: rampDown, target: 0 }
      ];
    case 'concurrency':
      return [{ duration, target: targetVus }];
    default:
      return [
        { duration: rampUp, target: targetVus },
        { duration: hold, target: targetVus },
        { duration: rampDown, target: 0 }
      ];
  }
}

export const options = {
  stages: stagesFor(testType),
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    checks: ['rate>0.99']
  },
  tags: {
    test_type: testType
  }
};

function requestUrl() {
  const separator = path.includes('?') ? '&' : '?';
  return testType === 'volume' ? `${baseUrl}${path}${separator}limit=${dataSize}` : `${baseUrl}${path}`;
}

export default function () {
  const response = method === 'POST'
    ? http.post(requestUrl(), null, { tags: { endpoint: path } })
    : http.get(requestUrl(), { tags: { endpoint: path } });

  check(response, {
    'response status is 2xx': (result) => result.status >= 200 && result.status < 300,
    'response has a body': (result) => Boolean(result.body)
  });

  sleep(Number(__ENV.THINK_TIME || 1));
}
