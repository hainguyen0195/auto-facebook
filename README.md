# Nhịp Đăng

Webapp tiếng Việt để quản lý nội dung, tài khoản Facebook, hội nhóm và lịch nhắc đăng bài. Chạy local trước; cùng mã nguồn và PostgreSQL có thể triển khai trên VPS Linux.

**Có hai cách thực hiện:** nhắc bạn đăng thủ công hoặc máy desktop nhận lịch và tự đăng bằng profile Facebook đã xác nhận. Thành phần desktop đang ở giai đoạn thử nghiệm; chưa đăng thật bằng tài khoản của bạn. Xem [hướng dẫn kết nối 5 tài khoản](docs/desktop.md). Mật khẩu, cookie và 2FA Facebook ở trong trình duyệt trên máy đăng.

## Chạy trên máy này

**Máy đăng Windows chạy nền:** trên web VPS, mở **Máy đăng & Facebook → Tải bộ cài Windows**, mở file tải về một lần. Bộ cài mang theo Node.js, tự ghép nối và thiết lập tự chạy khi đăng nhập Windows. Sau đó điều khiển Facebook ngay trên web; không cần mở `Start-Desktop.cmd` mỗi ngày. Máy vẫn cần bật và có mạng. Xem [cài ứng dụng nền](docs/desktop.md#ứng-dụng-nền-windows-cài-một-lần).

**Dùng Windows và MacBook:** tải bộ cài tương ứng trong **Máy đăng & Facebook** trên web VPS. MacBook hỗ trợ macOS 14+, Apple Silicon và Intel; giải nén ZIP, mở `Cai-Nhip-Dang.command` một lần, ứng dụng tự cài Node.js/Chromium và tự chạy khi đăng nhập macOS. Đăng nhập Facebook lần đầu trên từng máy, sau đó chọn **Dùng máy này** để chuyển. Tin nhắn dùng cùng phiên trên máy đang được chọn và có bộ chọn tài khoản. Không cần database riêng trên Mac. Xem [hướng dẫn chuyển máy và Tin nhắn](docs/desktop.md#windows-công-ty-và-macbook-ở-nhà).

**Tạm dừng và đóng cửa sổ:** tạm dừng máy sẽ dừng tự đăng, tương tác và kiểm tra tin nhắn; tạm dừng tài khoản cũng dừng đọc tin nhắn của tài khoản đó. Đóng cửa sổ sẽ dừng kiểm tra tin nhắn cho đến khi chủ động mở/kiểm tra Facebook lại. Trình đọc tin nhắn chỉ dùng Chrome còn mở, không tự khởi chạy trình duyệt hoặc tạo tab đăng bài. Nếu vẫn bật tự đăng, lịch đến hạn có thể mở lại cửa sổ; muốn dừng toàn bộ thì tạm dừng máy. Phiên Facebook và lịch được giữ nguyên.

Yêu cầu Node.js 24, npm và Windows x64/Linux được embedded-postgres hỗ trợ. Trên Linux chạy bằng tài khoản thường; PostgreSQL không chạy dưới root. Nếu dùng PostgreSQL có sẵn, xem phần tương ứng bên dưới.

```powershell
npm ci
npm run local:init
npm run user:create -- --email ban@example.com --name "Tên bạn"
npm run local
```

Mở **http://localhost:3000**. `user:create` sinh mật khẩu ngẫu nhiên và hiển thị một lần trong terminal. Có thể đặt mật khẩu riêng bằng biến môi trường `NEW_USER_PASSWORD` trước khi chạy lệnh; tối thiểu 12 ký tự. Đổi mật khẩu trong **Thiết lập & hướng dẫn** sau khi đăng nhập.

Menu **Hướng dẫn** có cách kết nối Facebook, dùng VPS/điện thoại, cài máy đăng và chuyển giữa desktop/laptop. Đổi email ứng dụng tại **Thiết lập & hướng dẫn → Đổi email đăng nhập**, xác nhận bằng mật khẩu hiện tại. Khi đổi thành công, mọi phiên web kết thúc; đăng nhập lại bằng email mới và mật khẩu cũ. Dữ liệu và kết nối máy đăng được giữ nguyên. Hiện chưa gửi email xác minh hoặc email đặt lại mật khẩu.

Trong lần triển khai này đã tạo sẵn tài khoản local: xem `.data/local-access.txt`. File này, `.env` và toàn bộ `.data` được gitignore. Giữ kín chúng.

`local:init` tạo PostgreSQL riêng tại `.data/postgres`, chỉ nghe trên `127.0.0.1:55432`, sinh secret trong `.env` và áp dụng migrations. Không dùng hoặc thay đổi dịch vụ PostgreSQL khác trên máy. Chạy lại lệnh giữ nguyên dữ liệu.

`npm run local` chuẩn bị bản production rồi khởi động web ở localhost và worker nhắc việc. Chờ hoàn tất build trước khi mở trang; bản này không tự refresh khi file thay đổi. Chỉ khi sửa code mới dùng `npm run local -- --dev`. Ctrl+C dừng web/worker; database vẫn chạy. Dùng `npm run local:stop` để dừng database an toàn, giữ nguyên dữ liệu. Dùng `npm run local:db` để bật lại.

Nếu cần chạy từng phần riêng:

```powershell
npm run local:db
npm run dev
# terminal khác
npm run worker
```

Luôn truy cập bằng `http://localhost:3000`, khớp `BETTER_AUTH_URL`. Nếu đổi domain/port, cập nhật biến này và khởi động lại.

### PostgreSQL có sẵn

Tạo database riêng, sao chép `.env.example` thành `.env`, điền `DATABASE_URL`, `BETTER_AUTH_URL` và secret ngẫu nhiên tối thiểu 32 ký tự. Sau đó chạy `npm run db:generate`, `npm run db:migrate`, `npm run user:create`, `npm run dev` và `npm run worker`. Không chạy `local:init` với URL trỏ sang database khác.

### Bản production local

```powershell
npm run build
npm start
# terminal khác
npm run worker
```

Không chạy development server đồng thời với build/production server trong cùng thư mục `.next`. Bước `postbuild` loại `.env` khỏi đầu ra standalone và kiểm tra dữ liệu local không bị đưa vào bản triển khai.

## Quy trình sử dụng

1. **Tài khoản Facebook:** thêm tên, link cá nhân và đúng tên Chrome/Edge profile. Bật **Áp dụng giờ nghỉ** để tạm dừng đăng bài và tương tác tự động trong khung giờ UTC+7 đã đặt; bỏ chọn để làm cả ngày. Có thể bật/tắt ngay trên thẻ tài khoản hoặc chỉnh khung giờ trong màn hình sửa. Tắt giờ nghỉ vẫn giữ khung giờ cũ, giới hạn việc/ngày và khoảng cách đăng. Trạng thái là do bạn cập nhật, không phải kết quả kiểm tra phiên Facebook.
2. **Hội nhóm:** thêm nhóm đã tham gia, nội quy và liên kết các tài khoản. Có thể nhập Excel `.xlsx` (trang tính đầu tiên) hoặc CSV UTF-8, xem trước lỗi và loại trùng. File mẫu trong ứng dụng dùng khoảng cách theo phút; vẫn đọc được cột giờ trong mẫu cũ. Dòng ví dụ chưa thay link nhóm được báo lỗi và bỏ qua. Tối đa 1 MB, 1.000 dòng/lần; có phân trang và tìm kiếm trên server.
3. **Thư viện bài:** soạn nội dung và ảnh; bản nháp trên máy được tách theo workspace. Mỗi ảnh tối đa 10 MB; JPG, PNG, WebP; tối đa 20 ảnh/bài. Ảnh được kiểm tra bytes, xoay, giới hạn cạnh 2.400 px và bỏ metadata. Giới hạn lưu trữ mặc định 500 MB/1.000 ảnh mỗi workspace.
4. **Lên lịch:** chọn bài, từng tài khoản và các nhóm đã liên kết hoặc trang cá nhân. Tối đa 500 nơi/lịch. Xem trước giờ UTC+7 và các nhắc nhở về trùng nội dung, khoảng cách đăng, giờ nghỉ, mức công việc do bạn đặt.
5. **Hôm nay:** bắt đầu một việc, sao chép nội dung, tải từng ảnh, kiểm tra đúng profile rồi mở Facebook. Nếu clipboard bị từ chối, dùng ô sao chép thủ công.
6. **Kết quả:** lịch thủ công do bạn xác nhận; lịch tự động có nguồn Máy đăng ghi nhận. Bài chờ duyệt chưa được tính là đã đăng; quay lại Lịch sử để cập nhật và thêm link bài. Xuất CSV theo bộ lọc để mở trong Excel.

Khi báo tài khoản bị hạn chế hoặc tạm nghỉ, các công việc chưa gửi của tài khoản bị tạm dừng. Chỉ tiếp tục khi bạn chủ động chuyển tài khoản sang Sẵn sàng; lịch quá hạn vẫn được giữ. Lưu trữ tài khoản/nhóm sẽ hủy các việc chưa xử lý liên quan. Hủy nhiều lịch luôn có bước xác nhận. Không có thao tác nào trong ứng dụng xóa bài trên Facebook.

Các mức công việc không bảo đảm tránh hạn chế Facebook. Tham khảo [chính sách spam Meta](https://transparency.meta.com/policies/community-standards/spam/). Groups API đã [bị gỡ từ 22/04/2024](https://developers.facebook.com/docs/graph-api/changelog/version19.0/).

## VPS Linux và HTTPS

Yêu cầu Docker Engine + Compose v2, domain trỏ đến VPS, mở 80/443. Mục tiêu ban đầu là 2 vCPU/4 GB RAM; đo RAM/CPU thực tế trước khi mở cho nhiều người. Build image có thể cần thêm RAM/swap; có thể build trên máy/CI rồi chuyển image. Không có trình duyệt Facebook chạy trên VPS.

1. Đưa mã nguồn lên VPS, loại `node_modules`, `.next`, `.data` và `.env` local.
2. Sao chép `.env.vps.example` thành `.env`; dùng hai chuỗi hex ngẫu nhiên khác nhau cho password database và auth secret. Tạo chuỗi bằng `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. `DATABASE_URL` phải dùng cùng password của `POSTGRES_PASSWORD`. Điền domain HTTPS vào `BETTER_AUTH_URL`, hostname vào `APP_DOMAIN`.
3. Chạy:

```sh
docker compose -f compose.yml -f compose.prod.yml up -d --build
docker compose exec web node node_modules/tsx/dist/cli.mjs scripts/create-user.ts --email ban@example.com --name "Tên bạn"
```

PostgreSQL không mở cổng ra Internet; web chỉ bind loopback 3000. Caddy tiếp nhận HTTPS và reverse proxy vào web. Web/worker chờ migration hoàn tất. Ảnh và database nằm trong named volumes bền vững. Không bật đăng ký công khai; tạo thêm người dùng bằng cùng lệnh `create-user`. Mỗi người tự có workspace riêng.

Kiểm tra `docker compose ps`, `docker compose logs --tail 100 web worker` và `/api/v1/health`. Endpoint health kiểm tra kết nối database; log worker cần có `worker.ready`. Worker quét mỗi phút, tự rà lịch quá hạn khi khởi động; không gọi API Facebook. Chỉ truy cập ứng dụng bằng domain HTTPS đã cấu hình.

### Chuyển dữ liệu local lên VPS

Nếu VPS đã có Traefik phục vụ các ứng dụng khác, dùng `compose.yml` cùng `compose.traefik.yml` thay cho `compose.prod.yml`. Bản này không mở cổng web ra host và dùng network proxy hiện có. Cần Docker Compose 2.24.4 trở lên để hỗ trợ `!reset`.

Ví dụ cấu hình bổ sung trong `.env` trên VPS:

```dotenv
COMPOSE_FILE=compose.yml:compose.traefik.yml
COMPOSE_PROJECT_NAME=autotool
APP_IMAGE=autotool:local
APP_DOMAIN=autotool.pmcoding.com
BETTER_AUTH_URL=https://autotool.pmcoding.com
TRAEFIK_NETWORK=proxy_net
TRAEFIK_CERT_RESOLVER=letsencrypt
```

Giữ các biến database, auth secret và media như mẫu VPS. `proxy_net` phải tồn tại; tên entrypoint `websecure` và resolver phải khớp Traefik đang chạy. Không chạy thêm Caddy trên cùng cổng 80/443. Sau đó dùng `docker compose up -d --build`; các lệnh backup/restore cũng đọc `COMPOSE_FILE` trong `.env` này.

Chạy `npm run backup:local` trên máy local. Chuyển riêng thư mục backup đến VPS qua kênh bảo mật, rồi khôi phục bằng hướng dẫn sau. Backup PostgreSQL 18 + ảnh tương thích định dạng restore của Docker. Chuyển secret ứng dụng qua kênh riêng nếu muốn giữ tính nhất quán phiên đăng nhập; có thể dùng secret mới và yêu cầu đăng nhập lại. Giữ bản local cho đến khi đã kiểm tra bản VPS.

## Sao lưu và khôi phục

Local: `npm run backup:local`. Công cụ dùng snapshot PostgreSQL và giữ khóa cập nhật ảnh trong lúc sao lưu. Trong thời gian này thao tác tải/xóa ảnh có thể phải chờ. Backup nằm trong `.data/backups/<thời-gian>` gồm `database.dump`, `media.tar.gz`, `manifest.txt`. Thiếu file ảnh sẽ làm backup thất bại thay vì báo thành công.

Trên Windows, lần sao lưu đầu tải công cụ `pg_dump`/`pg_restore` PostgreSQL 18.6 từ kho chính thức EDB vào `.data/pg-tools`. Trên Linux cần cài PostgreSQL client 18 trở lên. Có thể đặt `PG_BIN` trỏ đến thư mục chứa hai công cụ tương thích; không dùng client cũ hơn phiên bản server. Cần có lệnh `tar` trong PATH.

VPS, chạy từ thư mục dự án:

```sh
sh scripts/backup.sh /duong-dan-backup
sh scripts/restore.sh /duong-dan-backup/THU_MUC_CU_THE --confirm-replace
```

Backup VPS tạm dừng web/worker để database và ảnh có cùng mốc; tự bật lại khi kết thúc. Restore thay dữ liệu hiện tại và chỉ bật web/worker khi thành công. Nếu restore lỗi, giữ dịch vụ dừng để kiểm tra. Giữ bản backup mới của dữ liệu hiện tại trước khi restore. Những file ảnh dư từ trước có thể còn trên volume nhưng không xuất hiện nếu không được database tham chiếu.

Sao lưu database **và** ảnh mỗi ngày, giữ bản ngoài VPS và bảo vệ dữ liệu backup bằng lưu trữ mã hóa. Lưu secret cấu hình riêng. Sau restore, kiểm tra đăng nhập, một ảnh cũ, bài chờ duyệt và lịch quá hạn. Không dùng `docker compose down -v` nếu cần giữ dữ liệu.

## Kiểm thử

```sh
npm run typecheck
npm test
npm run test:integration
npm run build
npx playwright install chromium
npm run test:e2e
```

Integration/E2E tự dùng hai database `nhipdang_integration_test` và `nhipdang_e2e_test`, tách khỏi database ứng dụng. Có thể chỉ định `TEST_DATABASE_URL`; tên database bắt buộc kết thúc bằng `_test`. Khi tùy chỉnh, dùng database riêng cho mỗi bộ kiểm thử để ảnh và dữ liệu không bị trộn. Tài khoản kết nối cần quyền tạo database test và áp dụng migration. E2E chạy bản production trên localhost:3100, không dùng tài khoản local thật.

Kiểm thử bao gồm phân quyền API/ảnh, chống yêu cầu cross-site, vô hiệu đăng ký công khai, 10 tài khoản/100 nhóm, idempotency, snapshot bài, trạng thái chờ duyệt, tạm dừng/tiếp tục, worker chạy lại, CSV, lỗi mạng/clipboard và bố cục mobile. Các file kết quả, ảnh chụp và trạng thái đăng nhập test nằm trong thư mục gitignore.

## Cấu trúc và giới hạn

Next.js/React/TypeScript, Tailwind, shadcn-style Radix UI, TanStack Query, React Hook Form/Zod, Prisma/PostgreSQL, Better Auth, pg-boss và Sharp. Font Be Vietnam Pro được phục vụ local.

- `src/lib/service.ts`: nghiệp vụ; mutations khóa theo workspace, kiểm tra quyền trước khi ghi.
- `src/app/api/v1/[...path]/route.ts`: API có session và kiểm tra Origin khi ghi; ảnh trả `private, no-store`.
- `src/worker.ts`: worker nhắc việc; queue nằm trong PostgreSQL.
- `prisma/migrations`: migration có version; schema xác thực không lưu phiên Facebook.
- `docs/product-references.md`: cách tham khảo Orbitama, MaxMorus và hình Jx2 AI bạn gửi.

Đã có desktop tự đăng văn bản/ảnh, hàng đợi tương tác do bạn duyệt/thực hiện và xem đoạn Tin nhắn qua phiên Facebook đã kết nối trên máy đăng. Tin nhắn chỉ gồm danh sách đã quan sát, không gửi/trả lời hoặc mở hội thoại; dữ liệu quan sát giữ tối đa 24 giờ. Chưa có Fanpage API, bộ cài desktop EXE, extension, video, AI tìm lead, gửi tin nhắn, thanh toán hoặc nhân viên cùng workspace. Không tự thu thập nhóm hoặc số liệu tương tác. Trạng thái phiên Facebook chỉ được kiểm tra tại máy đăng. Danh sách bài trong bộ chọn lịch hiển thị 100 bài gần nhất; với thư viện lớn, lên lịch trực tiếp từ thẻ bài ở trang Thư viện có tìm kiếm/phân trang. Lịch trực quan tải 100 công việc/lần và có nút tải thêm; thống kê tính toàn bộ kết quả của bộ lọc.

Repo này được viết mới; không lấy mã từ các công cụ Facebook bên thứ ba. Thông tin tham khảo không phải xác nhận các dịch vụ đó hoạt động ổn định hay bảo đảm an toàn tài khoản.
