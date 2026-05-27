import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const demoDir = './demo-logs';

export function createDemoLogs(dir) {
  writeFileSync(join(dir, 'gateway-service.log'), [
    '2026-05-07 10:00:01 INFO service=gateway host=gw-01 route=/api/order status=200 cost=31ms',
    '2026-05-07 10:04:10 WARN service=gateway host=gw-01 upstream order-service slow cost=1800ms',
    '2026-05-07 10:04:22 ERROR service=gateway host=gw-01 status=502 trace_id=a1 upstream=order-service',
    '2026-05-07 10:04:30 ERROR service=gateway host=gw-01 status=502 trace_id=a2 upstream=order-service',
    '2026-05-07 10:05:01 ERROR service=gateway host=gw-02 status=502 trace_id=a3 upstream=order-service',
    '2026-05-07 10:20:01 INFO service=gateway host=gw-01 route=/health status=200 cost=2ms',
  ].join('\n'), 'utf8');

  writeFileSync(join(dir, 'order-service.log'), [
    '2026-05-07 10:01:02 INFO service=order host=ord-01 create order_id=1001 user_id=501 ok',
    '2026-05-07 10:05:03 ERROR service=order host=ord-01 call payment timeout order_id=1002 cost=3000ms',
    '2026-05-07 10:05:10 ERROR service=order host=ord-01 call payment timeout order_id=1003 cost=3100ms',
    '2026-05-07 10:05:20 ERROR service=order host=ord-02 call payment timeout order_id=1004 cost=3200ms',
    '2026-05-07 10:06:01 WARN service=order host=ord-01 retry payment order_id=1002 retry=1',
  ].join('\n'), 'utf8');

  writeFileSync(join(dir, 'payment-service.log'), [
    '2026-05-07 10:02:00 INFO service=payment host=pay-01 charge order_id=1001 ok',
    '2026-05-07 10:07:01 ERROR service=payment host=pay-01 database pool exhausted active=50 max=50',
    '2026-05-07 10:07:12 ERROR service=payment host=pay-01 connection refused db=10.0.0.8:5432',
    '2026-05-07 10:07:30 ERROR service=payment host=pay-02 connection refused db=10.0.0.8:5432',
    '2026-05-07 10:08:01 FATAL service=payment host=pay-01 payment worker panic trace_id=b99',
  ].join('\n'), 'utf8');
}
