# PostgreSQL transaction harness / ห้องทดลองธุรกรรมจริง

This reference harness is separate from the static browser lab. It executes real
PostgreSQL transactions through the installed psql client, using Node.js 20+
standard-library modules. No npm packages, HTTP server, production migration,
payment integration or hosted game service are added.

## เริ่มใน cloud

เปิด Actions → **PostgreSQL transaction integration** บน branch นี้
workflow สร้าง PostgreSQL 17 service ชั่วคราว แล้วรัน unit/static checks และ
integration tests จริง การเปิดหน้าเว็บไม่ได้เปิดฐานข้อมูลหรือเรียก harness

หากใช้ cloud runner ของตนเอง ต้องเตรียมฐานข้อมูล **ทิ้งได้เท่านั้น** ชื่อ
gameguard_test_ ตามด้วยอักษรเล็ก ตัวเลข หรือ underscore 1–40 ตัว
และ role ที่สร้าง schema ในฐานข้อมูลนี้ได้ จากนั้นตั้งค่าผ่าน environment:

~~~sh
export GAMEGUARD_ALLOW_DISPOSABLE_DATABASE=1
export GAMEGUARD_TEST_DATABASE_URL='postgresql://test-role@127.0.0.1/gameguard_test_manual'
npm run check
npm run test:postgres
~~~

ใส่ credential จริงผ่าน secret ของ runner เท่านั้น ไม่ commit และไม่ใส่เป็น argv
CI service ใช้ trust authentication ภายใน job ชั่วคราว จึงห้ามนำ service config
นี้ไปเปิดเป็นฐานข้อมูลถาวรหรือเปิดสู่เครือข่ายสาธารณะ

## สิ่งที่ทดสอบ

- ซื้อสำเร็จ: หักเงิน ลด stock เพิ่ม inventory โอน treasury และบันทึก receipt
  อยู่ใน transaction เดียว
- ผู้ซื้อ 20 บัญชีส่งคำสั่งพร้อมกันผ่าน psql คนละ process/connection
  ซื้อสินค้าชิ้นสุดท้ายได้เพียงหนึ่งครั้ง
- คีย์เดียวกัน 12 คำสั่งพร้อมกัน เกิดผลครั้งเดียว; retry ได้ receipt เดิม
- รัน Node worker สอง process ต่อกัน โดยทิ้ง response แรก แล้ว retry
  ข้อมูล idempotency ยังคงอยู่ใน PostgreSQL หลัง application process จบ
- key เดิมแต่ payload เปลี่ยนถูกปฏิเสธ
- principal ไม่ใช่เจ้าของ เงินไม่พอ หรือ inventory เต็ม: ไม่เกิดการเปลี่ยนบางส่วน
- จงใจให้ SQL error หลัง purchase ใน transaction แล้วปล่อย connection จบ:
  เงิน stock inventory treasury และ receipt ถูก rollback พร้อมกัน

ชุดนี้ไม่ได้ restart PostgreSQL หรือจำลอง disk failure/network partition
ไม่ใช่ load benchmark หรือคำรับรอง production security

## Transaction contract

The trusted principal is a separate {id} argument. The purchase command accepts
exactly {key, account, item, quantity}; client-supplied actor is rejected.
A real application must obtain the principal from its authenticated server
session. This harness does not implement authentication, and must not be exposed
as a public endpoint. PostgreSQL function rights remain invoker rights, never
SECURITY DEFINER.

Idempotency keys are scoped to the trusted principal. A transaction-scoped advisory
lock serializes that principal/key pair. The function then
locks the account, shop row and treasury in that order. A successful request stores
its normalized principal/account/item/quantity and result with all state changes.
An identical successful key replays without new effects. Changed commands are
denied. Failed commands do not reserve keys. Ownership is checked before reading
a prior result. Advisory hash collisions cause extra waiting, not extra effects.

Numbers are bounded integers. Balances, stock, inventory and prices are limited
to 1,000,000,000; treasury is bounded to JavaScript's safe integer maximum.
SQL constraints enforce nonnegative balances and quantities. Each client process
also has connection, statement, lock, output and wall-time limits. SQL receives
only validated identifiers and integers; no shell is used. Errors use stable
codes and omit connection URLs, credentials, SQL diagnostics and source input.

## Disposable database and cleanup guard

Both explicit opt-in and the database-name pattern are mandatory before any
process starts. Each connection also checks current_database() against the
validated name. URL connection options are restricted to one sslmode parameter;
inherited PGOPTIONS/PGSERVICE settings are not forwarded.

Each suite creates a random gameguard_harness_ + 16-hex-character schema.
Schema setup is transactional. Fixture resets truncate only known tables in that
schema. Cleanup runs only for a schema successfully created by that harness
instance and validates its exact name before DROP SCHEMA ... CASCADE.
It never drops a database or the public schema. Use a role confined to a
disposable database: the name check cannot determine whether a human has put
valuable data in that database.

## Files and evidence

- postgres/schema.sql: tables, constraints and purchase function
- postgres/harness.cjs: guarded psql runner and bounded fixture helpers
- postgres/retry-worker.cjs: fresh application-process retry fixture
- tests/postgres-config.test.cjs: pure configuration, identity and injection checks
- integration/postgres.test.cjs: actual database tests; missing config is an error
- .github/workflows/postgres.yml: cloud PostgreSQL service and test commands

Hosted integration results are pending execution. Read the Actions result for the
exact commit; presence of tests or workflow source does not mean they passed.
The existing reports/validation.json is browser/unit validation, not PostgreSQL
execution evidence. npm run test:postgres emits its own TAP output in Actions.
