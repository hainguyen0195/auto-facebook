# Tin nhan tren iPhone

## Cai icon va bat thong bao

1. Dung Safari mo `https://autotool.pmcoding.com/inbox`.
2. Chia se > Them vao Man hinh chinh > Them.
3. Mo icon Autotool, dang nhap ung dung, bam Bat thong bao > Cho phep.
4. Bam Thu thong bao de kiem tra tren dung dien thoai.

Can iOS 16.4 tro len. Quyen thong bao phai duoc cap tu thao tac cua nguoi dung
trong ung dung da them vao Man hinh chinh. iOS quan ly am thanh, huy hieu va
che do Tap trung trong Cai dat > Thong bao > Autotool.

## Y nghia so dem

- Dem hoi thoai co dau chua doc quan sat duoc, khong dem tung tin nhan.
- Danh sach Messenger duoc doc mot phan; khong khang dinh day du toan bo hop thu.
- Tai khoan ngoai tuyen/tam dung giu so gan nhat kem trang thai va thoi diem.
- Xem tong quan/chi tiet trong Autotool khong danh dau da doc tren Facebook.
- Phien Facebook tren may dang phai dang hoat dong. Bo theo doi khong tu mo
  lai Chrome khi nguoi dung da tam dung/dong cua so.
- Snapshot het han sau 24 gio theo co che hien co.

## May chu

`WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY` va `WEB_PUSH_SUBJECT` can duoc
truyen vao ca web va worker. Tao mot cap VAPID bang
`web-push.generateVAPIDKeys()` va giu nguyen qua cac lan deploy. Khong dua
private key vao frontend, log, tai lieu hay ma nguon.

Worker kiem tra outbox moi 5 giay. Snapshot online hop le chi danh dau can gui
khi so chua doc thay doi hoac co hoi thoai chua doc moi/doan xem truoc thay doi.
Gop cac thay doi vao mot thong bao cho moi thiet bi; khong gui noi dung tin
nhan/ten khach ra dich vu push. Cap nhat giam so dem dung thong bao khong am
thanh cung tag, vi iOS yeu cau moi push phai hien thi thong bao.

Dang ky push gan voi phien dang nhap ung dung. Dang xuat/xoa phien hoac het han
se ngung gui; mo lai ung dung de dang nhap va bat lai neu can. Tat thong bao
chi tac dong thiet bi hien tai. Endpoint 404/410 duoc xoa; loi tam thoi duoc
thu lai voi thoi gian cho tang dan. Service worker khong cache trang/API.

## Kiem tra sau deploy

- Manifest, icon Apple/192/512 va `/sw.js` truy cap qua HTTPS.
- `/sw.js` tra `Cache-Control: no-store`; manifest khoi dong tai `/inbox`.
- API push yeu cau dang nhap va dung Origin; private key khong co trong response.
- Dang ky va Thu thong bao tren iPhone that, khoa man hinh, gui tin nhan moi
  tu tai khoan thu nghiem roi kiem tra ten nick, huy hieu va mo dung `/inbox`.
- Doc tin tren Messenger, cho lan quan sat tiep theo de kiem tra giam so.
- Tam dung may/dang xuat/de loai bo quyen: khong bao tin moi gia.

Playwright mo phong quyen va dang ky push; kiem thu transport dung ban gia.
Kiem thu do khong thay the xac nhan Apple Web Push tren iPhone that.
