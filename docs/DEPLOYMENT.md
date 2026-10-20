# เว็บจริง yesspec

## ทางเข้าและการอัปเดตปัจจุบัน

ใช้ https://yesspec.com/admin เป็นทางเข้าหลัก โดยส่งต่อไป `admin-ranking.html` ส่วน `admin.html` เก็บเครื่องมือรุ่นเดิมและมีปุ่มไป Top 20

พบเมื่อ 20 ตุลาคม 2026 ว่า `/etc/cron.d/yesspec-sync` เดิมใช้ `git checkout origin/main -- .` ทุก 10 นาที จึงทับการอัปโหลดตรงด้วยโค้ดเก่า แก้โดยนำโค้ดเข้าสู่ GitHub และเปลี่ยน cron ให้เรียก `deploy/sync.sh` ภายใต้ `flock` แทน ห้ามใช้คำสั่ง checkout เดิมกับ web root อีก

ตัวอัปเดตอ่าน commit จาก `origin/main` ไปพื้นที่ staging แล้วใช้ `deploy/release-files.json` เลือกไฟล์เผยแพร่ รวม static outputs ใน `dist/`, `assets/`, sitemap และดัชนีบทความรายเดือนเพื่อให้งานสร้างบทความเดิมเผยแพร่ต่อได้ สำรองไฟล์ก่อนเปลี่ยน ตรวจ Python, API, Nginx และเริ่มบริการใหม่เมื่ออัปเดตสำเร็จ หากตรวจไม่ผ่านจะคืนไฟล์และเริ่มบริการรุ่นเดิม เก็บ commit ที่เผยแพร่แล้วใน `/var/lib/yesspec-deploy/current-commit` การเรียกซ้ำกับ commit เดิมไม่แก้ไฟล์

ห้ามใส่ `data/ranking_manual_offers.json`, `data/manual_overrides.json`, `data/daily_prices_feed.json`, `data/market_observations.jsonl` หรือ `data/affiliate_config.json` ลง release manifest ตัวติดตั้งปฏิเสธไฟล์เหล่านี้ และเก็บ CATEGORIES จากเว็บจริงไว้เพื่อไม่ทับค่าที่แอดมินเคยแก้ การเปลี่ยนรหัสหมวดหรือรายการเดิมต้องเตรียม migration ก่อน ไม่ใช้การทับทั้งชุด

การทดสอบจาก checkout ที่เผยแพร่: 60 Python tests และ 59 JavaScript tests ผ่าน อีก 1 Python test ใช้ข้อมูลวิจัยดิบในเครื่องจึงข้ามใน GitHub; การทดสอบชุดข้อมูลส่งออกยังทำงานตามปกติ

## บันทึกการเผยแพร่ครั้งแรก

อัปเดตเมื่อ 20 ตุลาคม 2026 (เวลาไทย): หลังบ้าน Top 20 และปุ่มตรวจราคาจากลิงก์เผยแพร่แล้วที่ https://yesspec.com/admin-ranking.html

- Web root: `/var/www/yesspec` บนเซิร์ฟเวอร์ที่โดเมนชี้อยู่
- Admin API: `yesspec-admin.service`, Python `/var/www/yesspec/admin_server.py`, รับภายในเครื่องที่ `127.0.0.1:3195`
- Nginx: `/etc/nginx/sites-available/yesspec`, proxy `/api/admin/` และ HTTPS เดิม
- Release: `yesspec-price-check-20261019T213926Z` (27 ไฟล์)
- ชุดอัปเดต: `/root/yesspec-releases/yesspec-price-check-20261019T213926Z`
- สำรองก่อนอัปเดต: `/root/yesspec-backups/yesspec-price-check-20261019T213926Z` มี `files.tar.gz`, `nginx.conf`, `before.json`, `deployed.json`

บัญชีและข้อมูลรับรองเดิมไม่เปลี่ยน เก็บ `data/daily_prices_feed.json` และรายการสินค้าเดิมใน `CATEGORIES` ของหน้าเว็บจริงไว้ (มี `soldCount` ของ Samsung A07 ต่างจากไฟล์พัฒนาอยู่หนึ่งค่า) อันดับ Top 20 ใช้ชุด `shopee_feed_rankings.json` แยกจากรายการเดิม และไม่ได้แปลงยอดนี้เป็นยอดขาย 30 วัน

ไฟล์ `data/ranking_manual_offers.json` ยังไม่มีบนเซิร์ฟเวอร์ก่อนอัปเดต จึงสร้างไฟล์ว่างครั้งแรก การตรวจหลังอัปเดตไม่บันทึกราคาหรือลิงก์ทดสอบ การอัปเดตครั้งถัดไปต้องรักษาไฟล์นี้และ `data/manual_overrides.json` ที่ผู้ดูแลใช้งานอยู่ ห้ามทับด้วยไฟล์ว่างจากเครื่องพัฒนา

ตรวจแล้ว: service ทำงาน, API หลังล็อกอินอ่านครบ 32 หมวด/640 รายการ, API หลังบ้านเดิมอ่าน 352 รุ่น, การตรวจราคาไม่ล็อกอินได้ 401, URL ผิดแพลตฟอร์มได้ 400, ปุ่มตรวจ Shopee บนเบราว์เซอร์เว็บจริงเปิดผลตรวจและกลับไปกรอกเองได้, หน้าหมวดสินค้าแสดง 20 รายการ ไม่มี console error ระหว่างตรวจ

ลิงก์จริง Shopee/Lazada ที่ทดลองคืน `no_price` อย่างถูกต้อง ยังไม่รับประกันการอ่านราคาทุกลิงก์หรือราคา VIP ของบัญชี ส่วนขั้นตอนเลือกราคาและยืนยันสำเร็จได้ทดสอบด้วยข้อมูลจำลองแยกจากเว็บจริงแล้วก่อนเผยแพร่ (ชุดทดสอบรวม 120 รายการผ่าน)

หลังบ้านใหม่ใช้ `private, no-store` และ `noindex, nofollow`; ไฟล์ช่องทางกรอกเองใช้ `no-store`; assets ใช้ query version เพื่อเปลี่ยน cache เมื่อแก้ไฟล์ ห้ามนำไฟล์รับรอง รหัสผ่าน หรือ bundle/backup ไปวางใน web root
