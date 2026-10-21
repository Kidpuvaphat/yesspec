# เว็บจริง yesspec

## ทางเข้าและการอัปเดตปัจจุบัน

ใช้ https://yesspec.com/admin/ เป็นทางเข้าหลักและคง URL นี้ขณะเปิดหลังบ้าน Nginx เสิร์ฟ `admin-ranking.html` ที่เส้นทางนี้ โดย `/admin` และ `/admin-ranking.html` ส่งต่อมาที่ `/admin/` พร้อม query string เดิม ขณะเปิดเฉพาะมือถือ `/admin.html` ส่งต่อมาที่เดียวกัน และ `/dist/` ส่งต่อไปหน้าหลัก ไฟล์เดิมยังอยู่ หน้า HTML กำหนด base URL เป็น `/` เพื่อให้รูป สคริปต์ ข้อมูล และลิงก์เมนูโหลดจากรากเว็บไซต์ได้ถูกต้อง

ตั้งแต่ 20 ตุลาคม 2026 ใช้ Hostinger รันเว็บ API และงานตามเวลาทั้งหมด GitHub เก็บโค้ดและการทดสอบที่สั่งเอง ไม่มีการดึงโค้ดทุก 10 นาทีแล้ว `/etc/cron.d/yesspec-sync` เหลือเพียงคำอธิบาย ห้ามนำคำสั่ง checkout หรือ polling เดิมกลับมา

เผยแพร่ด้วย `bash /var/www/yesspec/deploy/sync.sh <SHA เต็ม 40 ตัวที่ตรวจแล้ว>` เท่านั้น คำสั่งที่ไม่ระบุ SHA ถูกปฏิเสธก่อนติดต่อ GitHub ตัวอัปเดตนำ commit ที่เลือกไปพื้นที่ staging แล้วใช้ `deploy/release-files.json` เลือกไฟล์ รักษาบทความเก่าบนเซิร์ฟเวอร์และสร้าง sitemap ด้วย generator ของเวอร์ชันใหม่ สำรองไฟล์ก่อนเปลี่ยน ตรวจ Python, API และ Nginx หากตรวจไม่ผ่านจะคืนไฟล์และเริ่มบริการรุ่นเดิม เก็บ commit ที่เผยแพร่แล้วใน `/var/lib/yesspec-deploy/current-commit` การเรียกซ้ำกับ commit เดิมไม่แก้ไฟล์

ห้ามใส่ `data/ranking_manual_offers.json`, `data/manual_overrides.json`, `data/daily_prices_feed.json`, `data/market_observations.jsonl` หรือ `data/affiliate_config.json` ลง release manifest ตัวติดตั้งปฏิเสธไฟล์เหล่านี้ และเก็บ CATEGORIES จากเว็บจริงไว้เพื่อไม่ทับค่าที่แอดมินเคยแก้ การเปลี่ยนรหัสหมวดหรือรายการเดิมต้องเตรียม migration ก่อน ไม่ใช้การทับทั้งชุด

## งานประจำวันบน Hostinger

`yesspec-maintenance.timer` เรียก service เวลา **06:00 น. Asia/Bangkok** ทุกวัน เปิด `Persistent=true` เพื่อทำรอบที่พลาดเมื่อเครื่องกลับมาทำงาน ไม่เปลี่ยน timezone ของทั้งเซิร์ฟเวอร์

งานเรียงตามลำดับ: สำรองข้อมูลและตรวจ checksum → ประมวลผล feed จากหลักฐานเดิม → สร้างสถานะเดือน → สร้างหน้ารายเดือนและ sitemap การประมวลผลนี้ไม่ติดต่อ GitHub หรือ marketplace ไม่เปลี่ยนเวลาที่สังเกตราคาจริง ไม่เขียนไฟล์ราคาที่กรอกใน Top 20 และไม่ยืนยันราคาใหม่แทนผู้ใช้

ประมวลผลใน staging ก่อนเผยแพร่ output หากสคริปต์ล้มเหลวจะไม่เปลี่ยนข้อมูลจริง หากการคัดลอก output ล้มเหลวจะคืนไฟล์ที่เปลี่ยนแล้ว ใช้ file lock ร่วมกับ API บันทึกสินค้าเพื่อไม่ให้ทับการกรอกระหว่างงาน และ lock ร่วมกับ manual deploy เพื่อไม่รันซ้อนกัน

- ติดตั้ง/ตรวจงานครั้งแรก: `bash /var/www/yesspec/deploy/install-hostinger-ops.sh`
- ดูรอบถัดไป: `systemctl list-timers yesspec-maintenance.timer`
- เรียกเอง: `systemctl start yesspec-maintenance.service`
- ตรวจ log: `journalctl -u yesspec-maintenance.service`
- ผลสำเร็จล่าสุด: `/var/lib/yesspec-ops/last-success.json`

Workflow GitHub เดิม `daily_price_sync.yml` ถูกถอดออกและปิด schedule เหลือ `verify.yml` สำหรับสั่งทดสอบเอง ไม่มีสิทธิ์เขียน repository ไม่มีงานนำขึ้น Hostinger

## สำรองข้อมูลและตรวจการกู้คืน

สำรองก่อนงานรายวันใน `/root/yesspec-data-backups/yesspec-data-<UTC timestamp>.zip` เก็บ 30 ชุดล่าสุด ไฟล์ 0600 และโฟลเดอร์ 0700 อยู่นอก web root ภายในมี `data/`, index ที่มีข้อมูลรายการเดิม, บทความรายเดือน และ config ของระบบ/บัญชีแอดมิน จึงห้าม commit หรือวางในโฟลเดอร์เว็บ

ทุก archive มี `manifest.json` พร้อม SHA-256 ของแต่ละไฟล์ ตรวจ archive ใหม่สำเร็จก่อนหมุนเวียนไฟล์เก่า:

`python3 /var/www/yesspec/deploy/maintenance.py --verify-backup /root/yesspec-data-backups/<ชื่อไฟล์>.zip`

สำรองเพิ่มโดยไม่ประมวลผล: `python3 /var/www/yesspec/deploy/maintenance.py --backup-only`

ก่อนกู้คืน ให้ตรวจ checksum และแตกไฟล์ในโฟลเดอร์ส่วนตัวชั่วคราวก่อน ตรวจจำนวนรายการ/ลิงก์เทียบกับเป้าหมาย สำรองสถานะปัจจุบันและหยุด `yesspec-admin` ก่อนคัดลอกข้อมูลที่เลือกจาก `site/` กลับ web root แล้วเริ่มบริการและตรวจ API ไม่ต้องคืน credentials จาก `config/` หากบัญชีปัจจุบันยังใช้ได้

สำรองรายวันอยู่บน VPS เครื่องเดียว จึงยังไม่ทนต่อกรณีเสียทั้งเครื่อง ต้องมีการสำรองออกนอกเครื่องเพิ่มเติมตามปลายทางที่เจ้าของเลือก

ชุดทดสอบครอบคลุมการกู้ข้อมูลจาก archive, checksum เสีย, เก็บย้อนหลัง, ไม่ทับราคาหรือลิงก์ที่กรอก, ไม่เปลี่ยนเวลา observation, rollback เมื่อสร้าง/คัดลอกไม่สำเร็จ และไม่อนุญาต deploy โดยไม่ระบุ commit การทดสอบ raw research ในเครื่องยังข้ามเมื่อไม่มีข้อมูลดิบใน GitHub

## บันทึกการเผยแพร่ครั้งแรก

อัปเดตเมื่อ 21 ตุลาคม 2026: หลังบ้าน 30 รุ่นและปุ่มตรวจราคาจากลิงก์เผยแพร่แล้วที่ https://yesspec.com/admin/

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
